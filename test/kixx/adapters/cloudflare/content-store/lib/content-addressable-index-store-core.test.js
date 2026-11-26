import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableIndexStoreCore from '../../../../../../kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store-core.js';
import { BUILD_ASSIGNMENT_OUTCOME } from '../../../../../../kixx/content-addressable-store/content-store-interface.js';
import { createFakeDurableObjectState } from '../../../../../fakes/durable-object.js';
import { createFakeDurableObjectStorage } from '../../../../../fakes/durable-object-storage.js';


// Builds the core the way the Durable Object shell does, and waits for the
// constructor's schema initialization.
async function makeCore(options) {
    const state = createFakeDurableObjectState();
    const core = new ContentAddressableIndexStoreCore({ ctx: state, env: {}, ...options });
    await core.ready;
    return { core, sql: state.storage.sql };
}

function readPointerRow(sql, buildId) {
    return JSON.stringify(sql.exec('SELECT * FROM builds WHERE build_id = ?', buildId).toArray());
}

function readActivationRows(sql) {
    return JSON.stringify(sql.exec('SELECT * FROM activations ORDER BY sequence').toArray());
}

function makeIndex(blobHash) {
    return {
        '/': [ 'tree', 'root-hash' ],
        '/a.txt': [ 'blob', blobHash ?? 'hash-a', 5, { contentType: 'text/plain' } ],
    };
}

// Every assignment needs an Activation; most tests do not care what it says.
function assignment(fields) {
    return {
        activation: { reason: 'publish', actor: { type: 'deploy-key', id: 'test-key' } },
        ...fields,
    };
}

function releaseInput(fields) {
    return {
        releaseId: 'root-1',
        createdBy: { type: 'deploy-key', id: 'test-key' },
        objectCount: 1,
        totalBytes: 10,
        contractVersion: 2,
        provenance: {},
        ...fields,
    };
}

function listTables(sql) {
    return sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").toArray().map((row) => row.name).join(',');
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('ContentAddressableIndexStoreCore', ({ describe }) => {
    describe('constructor', ({ it }) => {
        it('initializes the schema inside one blockConcurrencyWhile() call', async () => {
            const state = createFakeDurableObjectState();
            let callCount = 0;
            const ctx = {
                storage: state.storage,
                blockConcurrencyWhile(callback) {
                    callCount += 1;
                    return state.blockConcurrencyWhile(callback);
                },
            };

            const core = new ContentAddressableIndexStoreCore({ ctx, env: {} });
            await core.ready;

            assertEqual(1, callCount);
            assertEqual(5, state.storage.sql.exec('SELECT version FROM content_schema').one().version);
            assertEqual(1, state.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'activations_build'").one().n);
            assertEqual('activations,builds,closure_entries,content_schema,objects,releases', listTables(state.storage.sql));
        });

        it('rejects ready when the storage holds an incompatible schema', async () => {
            const state = createFakeDurableObjectState();
            state.storage.sql.exec('CREATE TABLE legacy (x)');

            const core = new ContentAddressableIndexStoreCore({ ctx: state });
            const caught = await catchAsyncError(() => core.ready);

            assert(caught, 'expected ready to reject');
            assertEqual('AssertionError', caught.name);
            assertMatches('ContentAddressableIndexStore: incompatible unversioned schema', caught.message);
            assertEqual('legacy', listTables(state.storage.sql));
        });

        it('rejects ready for an older or newer schema version and changes nothing', async () => {
            for (const version of [ 4, 6 ]) {
                const state = createFakeDurableObjectState();
                const current = new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
                await current.ready;
                await current.saveIndex('root-1', makeIndex());
                state.storage.sql.exec('UPDATE content_schema SET version = ?', version);

                const core = new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
                const caught = await catchAsyncError(() => core.ready);

                assert(caught, 'expected ready to reject');
                assertEqual('AssertionError', caught.name);
                assertMatches('ContentAddressableIndexStore: incompatible schema version', caught.message);
                assertEqual(version, state.storage.sql.exec('SELECT version FROM content_schema').one().version);
                assertEqual('activations,builds,closure_entries,content_schema,objects,releases', listTables(state.storage.sql));
                assertEqual(2, state.storage.sql.exec('SELECT count(*) AS n FROM closure_entries').one().n);
            }
        });
    });

    describe('migrate', ({ it }) => {
        it('leaves a current schema and its rows as they are', async () => {
            const { core, sql } = await makeCore();
            await core.saveIndex('root-1', makeIndex());

            await core.migrate();
            await core.migrate();

            assertEqual('activations,builds,closure_entries,content_schema,objects,releases', listTables(sql));
            assertEqual(1, sql.exec('SELECT count(*) AS n FROM content_schema').one().n);
            assertEqual(2, sql.exec('SELECT count(*) AS n FROM closure_entries').one().n);
        });
    });

    describe('getBuild', ({ it }) => {
        it('resolves null root hash and entries for a build that is not registered', async () => {
            const { core } = await makeCore();

            const result = await core.getBuild('missing');

            assertEqual(true, result.success);
            assertEqual(null, result.rootHash);
            assertEqual(null, result.entries);
        });

        it('resolves the assigned root hash and its closure entries', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));

            const result = await core.getBuild('build-1');

            assertEqual(true, result.success);
            assertEqual('root-1', result.rootHash);
            assertEqual('/,/a.txt', Object.keys(result.entries).sort().join(','));
            assertEqual('tree,root-hash', result.entries['/'].join(','));
            assertEqual(4, result.entries['/a.txt'].length);
            assertEqual('blob', result.entries['/a.txt'][0]);
            assertEqual('hash-a', result.entries['/a.txt'][1]);
            assertEqual(5, result.entries['/a.txt'][2]);
            assertEqual('text/plain', result.entries['/a.txt'][3].contentType);
        });

        it('rejects an empty build id', async () => {
            const { core } = await makeCore();

            const caught = await catchAsyncError(() => core.getBuild(''));

            assert(caught, 'expected the call to reject');
            assertMatches('ContentAddressableIndexStore#getBuild: buildId', caught.message);
        });
    });

    describe('getIndex', ({ it }) => {
        it('resolves null entries for a closure that was never saved', async () => {
            const { core } = await makeCore();

            const result = await core.getIndex('unknown');

            assertEqual(true, result.success);
            assertEqual(null, result.entries);
        });

        it('resolves null entries for a closure saved with no entries', async () => {
            const { core } = await makeCore();
            await core.saveIndex('empty-root', {});

            const result = await core.getIndex('empty-root');

            assertEqual(null, result.entries);
        });

        it('resolves the entries of a saved closure', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex('hash-b'));

            const result = await core.getIndex('root-1');

            assertEqual(true, result.success);
            assertEqual('hash-b', result.entries['/a.txt'][1]);
        });

        it('rejects an empty root hash', async () => {
            const { core } = await makeCore();

            const caught = await catchAsyncError(() => core.getIndex(''));

            assert(caught, 'expected the call to reject');
            assertMatches('ContentAddressableIndexStore#getIndex: rootHash', caught.message);
        });
    });

    describe('getBuildPointer', ({ it }) => {
        it('resolves a null pointer for a build that is not registered', async () => {
            const { core } = await makeCore();

            const result = await core.getBuildPointer('missing');

            assertEqual(true, result.success);
            assertEqual(null, result.pointer);
        });

        it('resolves the pointer the assignment stored', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            const assigned = await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));

            const result = await core.getBuildPointer('build-1');

            assertEqual(true, result.success);
            assertEqual('root-1', result.pointer.rootHash);
            assertEqual(assigned.pointer.assignedAt, result.pointer.assignedAt);
            assertEqual(assigned.pointer.assignmentId, result.pointer.assignmentId);
            assertEqual(null, result.pointer.code);
        });

        it('resolves the code info the assignment stored', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            await core.assignBuild('build-1', assignment({
                rootHash: 'root-1',
                code: { revision: 'revision-1', fingerprint: 'fingerprint-1' },
            }));

            const { pointer } = await core.getBuildPointer('build-1');
            const { builds } = await core.listBuilds();

            assertEqual('{"revision":"revision-1","fingerprint":"fingerprint-1"}', JSON.stringify(pointer.code));
            assertEqual('{"revision":"revision-1","fingerprint":"fingerprint-1"}', JSON.stringify(builds[0].code));
            assertEqual('build-1', builds[0].buildId);
        });

        it('rejects an empty build id', async () => {
            const { core } = await makeCore();

            const caught = await catchAsyncError(() => core.getBuildPointer(''));

            assert(caught, 'expected the call to reject');
            assertMatches('ContentAddressableIndexStore#getBuildPointer: buildId', caught.message);
        });
    });

    describe('listBuilds', ({ it }) => {
        it('resolves an empty list when no build is assigned', async () => {
            const { core } = await makeCore();

            const result = await core.listBuilds();

            assertEqual(true, result.success);
            assertEqual(0, result.builds.length);
        });

        it('orders builds by newest assignment, then by build id', async () => {
            const { core, sql } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            for (const buildId of [ 'build-b', 'build-c', 'build-a', 'build-d' ]) {
                await core.assignBuild(buildId, assignment({ rootHash: 'root-1' }));
            }
            const setAssignedAt = (buildId, assignedAt) => {
                sql.exec('UPDATE builds SET assigned_at = ? WHERE build_id = ?', assignedAt, buildId);
            };
            setAssignedAt('build-a', '2026-01-02T00:00:00.000Z');
            setAssignedAt('build-b', '2026-01-03T00:00:00.000Z');
            setAssignedAt('build-c', '2026-01-01T00:00:00.000Z');
            setAssignedAt('build-d', '2026-01-02T00:00:00.000Z');

            const result = await core.listBuilds();

            assertEqual(true, result.success);
            assertEqual('build-b,build-a,build-d,build-c', result.builds.map((build) => build.buildId).join(','));
            assertEqual('root-1', result.builds[0].rootHash);
            assertEqual('2026-01-03T00:00:00.000Z', result.builds[0].assignedAt);
            assertEqual('string', typeof result.builds[0].assignmentId);
        });
    });

    describe('saveIndex', ({ it }) => {
        it('stores each entry as a row', async () => {
            const { core, sql } = await makeCore();

            const result = await core.saveIndex('root-1', makeIndex());

            const rows = sql.exec('SELECT pathname, kind, hash, size, metadata FROM closure_entries WHERE root_hash = ? ORDER BY pathname', 'root-1').toArray();
            assertEqual(true, result.success);
            assertEqual(2, rows.length);
            assertEqual('/|tree|root-hash', `${ rows[0].pathname }|${ rows[0].kind }|${ rows[0].hash }`);
            assertEqual(null, rows[0].size);
            assertEqual(null, rows[0].metadata);
            assertEqual('/a.txt|blob|hash-a', `${ rows[1].pathname }|${ rows[1].kind }|${ rows[1].hash }`);
            assertEqual(5, rows[1].size);
            assertEqual('{"contentType":"text/plain"}', rows[1].metadata);
        });

        it('keeps the first entry for a root hash and pathname that already exist', async () => {
            const { core, sql } = await makeCore();
            await core.saveIndex('root-1', makeIndex('first'));

            const repeated = await core.saveIndex('root-1', makeIndex('first'));
            const changed = await core.saveIndex('root-1', { ...makeIndex('second'), '/b.txt': [ 'blob', 'hash-b', 1, null ] });

            const rows = sql.exec('SELECT pathname, hash FROM closure_entries WHERE root_hash = ? ORDER BY pathname', 'root-1').toArray();
            assertEqual(true, repeated.success);
            assertEqual(true, changed.success);
            assertEqual('/:root-hash,/a.txt:first,/b.txt:hash-b', rows.map((row) => `${ row.pathname }:${ row.hash }`).join(','));
        });

        it('rejects an index that is not a plain object', async () => {
            const { core } = await makeCore();

            const caught = await catchAsyncError(() => core.saveIndex('root-1', [ [ 'tree', 'root-hash' ] ]));

            assert(caught, 'expected the call to reject');
            assertMatches('ContentAddressableIndexStore#saveIndex: index must be a plain object', caught.message);
        });

        it('rejects an empty root hash', async () => {
            const { core } = await makeCore();

            const caught = await catchAsyncError(() => core.saveIndex('', makeIndex()));

            assert(caught, 'expected the call to reject');
            assertMatches('ContentAddressableIndexStore#saveIndex: rootHash', caught.message);
        });
    });

    describe('registerFile', ({ it }) => {
        it('records the size, replacing an earlier one for the same hash', async () => {
            const { core } = await makeCore();

            const first = await core.registerFile('hash-a', 5);
            await core.registerFile('hash-a', 7);
            const empty = await core.registerFile('hash-empty', 0);

            const { files } = await core.statFiles([ 'hash-a', 'hash-empty' ]);
            assertEqual(true, first.success);
            assertEqual(true, empty.success);
            assertEqual(7, files[0].size);
            assertEqual(0, files[1].size);
        });

        it('rejects an empty hash', async () => {
            const { core } = await makeCore();

            const caught = await catchAsyncError(() => core.registerFile('', 5));

            assert(caught, 'expected the call to reject');
            assertMatches('ContentAddressableIndexStore#registerFile: hash', caught.message);
        });

        it('rejects a negative or non-integer size', async () => {
            const { core } = await makeCore();

            for (const size of [ -1, 1.5, '5', null, undefined ]) {
                const caught = await catchAsyncError(() => core.registerFile('hash-a', size));

                assert(caught, `expected the size ${ String(size) } to reject`);
                assertMatches('ContentAddressableIndexStore#registerFile: size', caught.message);
            }

            assertEqual(null, (await core.statFiles([ 'hash-a' ])).files[0]);
        });
    });

    describe('statFiles', ({ it }) => {
        it('resolves sizes in request order, with null for a hash that is not registered', async () => {
            const { core } = await makeCore();
            await core.registerFile('hash-a', 5);
            await core.registerFile('hash-b', 9);

            const result = await core.statFiles([ 'hash-b', 'missing', 'hash-a', 'hash-b' ]);

            assertEqual(true, result.success);
            assertEqual(4, result.files.length);
            assertEqual(9, result.files[0].size);
            assertEqual(null, result.files[1]);
            assertEqual(5, result.files[2].size);
            assertEqual(9, result.files[3].size);
        });

        it('accepts 100 hashes and rejects 101', async () => {
            const { core } = await makeCore();
            const hashes = Array.from({ length: 101 }, (_, index) => `hash-${ index }`);

            const result = await core.statFiles(hashes.slice(0, 100));
            const caught = await catchAsyncError(() => core.statFiles(hashes));

            assertEqual(100, result.files.length);
            assert(caught, 'expected 101 hashes to reject');
            assertMatches('ContentAddressableIndexStore#statFiles accepts at most 100 hashes', caught.message);
        });

        it('rejects an empty hash and a hashes argument that is not an array', async () => {
            const { core } = await makeCore();

            const emptyHash = await catchAsyncError(() => core.statFiles([ 'hash-a', '' ]));
            const notArray = await catchAsyncError(() => core.statFiles('hash-a'));

            assert(emptyHash, 'expected the empty hash to reject');
            assertMatches('ContentAddressableIndexStore#statFiles: hashes[1]', emptyHash.message);
            assert(notArray, 'expected the string to reject');
            assertMatches('ContentAddressableIndexStore#statFiles: hashes', notArray.message);
        });
    });

    describe('assignBuild', ({ it }) => {
        it('resolves success with the assignment result', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());

            const assigned = await core.assignBuild('build-1', assignment({ rootHash: 'root-1', expectedAssignmentId: null }));
            const unchanged = await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));

            assertEqual(true, assigned.success);
            assertEqual(BUILD_ASSIGNMENT_OUTCOME.ASSIGNED, assigned.outcome);
            assertEqual('root-1', assigned.pointer.rootHash);
            assertEqual(null, assigned.previousRootHash);
            assertEqual(true, unchanged.success);
            assertEqual(BUILD_ASSIGNMENT_OUTCOME.UNCHANGED, unchanged.outcome);
            assertEqual(assigned.pointer.assignmentId, unchanged.pointer.assignmentId);
        });

        it('resolves success with the outcome when nothing is assigned', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));

            const missing = await core.assignBuild('build-1', assignment({ rootHash: 'never-saved' }));
            const conflict = await core.assignBuild('build-1', assignment({ rootHash: 'root-1', expectedAssignmentId: null }));

            assertEqual(true, missing.success);
            assertEqual(BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE, missing.outcome);
            assertEqual(true, conflict.success);
            assertEqual(BUILD_ASSIGNMENT_OUTCOME.CONFLICT, conflict.outcome);
            assertEqual('root-1', (await core.getBuildPointer('build-1')).pointer.rootHash);
        });

        it('runs the pointer write and the Activation insert in one transactionSync() call', async () => {
            const state = createFakeDurableObjectState();
            const core = new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
            await core.ready;
            await core.saveIndex('root-1', makeIndex());
            const { storage } = state;
            const original = storage.transactionSync.bind(storage);
            const seen = [];
            storage.transactionSync = (callback) => {
                return original(() => {
                    const result = callback();
                    seen.push({
                        builds: storage.sql.exec('SELECT count(*) AS n FROM builds').one().n,
                        activations: storage.sql.exec('SELECT count(*) AS n FROM activations').one().n,
                    });
                    return result;
                });
            };

            await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));

            assertEqual('[{"builds":1,"activations":1}]', JSON.stringify(seen));
        });

        it('rolls back the pointer when its Activation cannot be written', async () => {
            // activations.assignment_id is unique, so a repeated identity
            // fails the Activation insert after the pointer was written.
            const { core, sql } = await makeCore({ randomUUID: () => '11111111-1111-4111-8111-111111111111' });
            await core.saveIndex('root-1', makeIndex());
            await core.saveIndex('root-2', makeIndex());
            await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));
            const pointerBefore = readPointerRow(sql, 'build-1');
            const activationsBefore = readActivationRows(sql);

            const caught = await catchAsyncError(() => core.assignBuild('build-1', assignment({ rootHash: 'root-2' })));

            assert(caught, 'expected the second assignment to throw');
            assertEqual(pointerBefore, readPointerRow(sql, 'build-1'));
            assertEqual(activationsBefore, readActivationRows(sql));
            assertEqual(1, JSON.parse(activationsBefore).length);
            assertEqual('root-1', (await core.getBuildPointer('build-1')).pointer.rootHash);
        });

        it('stamps the pointer and its Activation from the injected clock', async () => {
            const { core } = await makeCore({ now: () => Date.UTC(2027, 0, 15, 12) });
            await core.saveIndex('root-1', makeIndex());

            const assigned = await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));
            const { items } = await core.listActivations({ limit: 100 });

            assertEqual('2027-01-15T12:00:00.000Z', assigned.pointer.assignedAt);
            assertEqual('2027-01-15T12:00:00.000Z', items[0].activatedAt);
            assertEqual(assigned.pointer.assignmentId, items[0].assignmentId);
        });

        it('leaves the pointer and history alone for every outcome but assigned', async () => {
            const { core, sql } = await makeCore();
            const code = { revision: 'revision-1', fingerprint: 'fingerprint-1' };
            await core.saveIndex('root-1', makeIndex());
            await core.saveIndex('root-2', makeIndex());
            await core.assignBuild('build-1', assignment({ rootHash: 'root-1', code }));
            const pointerBefore = readPointerRow(sql, 'build-1');
            const activationsBefore = readActivationRows(sql);

            const outcomes = [];
            for (const fields of [
                { rootHash: 'never-saved' },
                { rootHash: 'root-2', expectedAssignmentId: null },
                { rootHash: 'root-2', code: { revision: 'revision-2', fingerprint: 'fingerprint-1' } },
                { rootHash: 'root-1', code },
            ]) {
                outcomes.push((await core.assignBuild('build-1', assignment(fields))).outcome);
            }

            assertEqual('missingClosure,conflict,codeMismatch,unchanged', outcomes.join(','));
            assertEqual(pointerBefore, readPointerRow(sql, 'build-1'));
            assertEqual(activationsBefore, readActivationRows(sql));
        });
    });

    describe('recordRelease', ({ it }) => {
        it('stamps a new record from the injected clock and keeps the first record', async () => {
            let now = Date.UTC(2027, 0, 15, 12);
            const { core, sql } = await makeCore({ now: () => now });
            await core.saveIndex('root-1', makeIndex());

            const created = await core.recordRelease(releaseInput({ provenance: { message: 'First' } }));
            now += 60000;
            const repeated = await core.recordRelease(releaseInput({
                createdBy: { type: 'user', id: 'user-2', name: 'Ada Editor' },
                provenance: { message: 'Second' },
            }));
            const read = await core.getRelease('root-1');

            assertEqual(true, created.success);
            assertEqual('created', created.outcome);
            assertEqual('2027-01-15T12:00:00.000Z', created.record.createdAt);
            assertEqual('exists', repeated.outcome);
            assertEqual(JSON.stringify(created.record), JSON.stringify(repeated.record));
            assertEqual(JSON.stringify(created.record), JSON.stringify(read.record));
            assertEqual('First', read.record.provenance.message);
            assertEqual(null, read.record.createdBy.name);
            assertEqual(undefined, read.record.sequence);
            assertEqual(1, sql.exec('SELECT count(*) AS n FROM releases').one().n);
        });

        it('resolves missingClosure without a record and writes nothing', async () => {
            const { core, sql } = await makeCore();
            await core.saveIndex('empty-root', {});

            const neverSaved = await core.recordRelease(releaseInput({ releaseId: 'never-saved' }));
            const empty = await core.recordRelease(releaseInput({ releaseId: 'empty-root' }));

            assertEqual('outcome,success', Object.keys(neverSaved).sort().join(','));
            assertEqual('missingClosure', neverSaved.outcome);
            assertEqual('missingClosure', empty.outcome);
            assertEqual(null, (await core.getRelease('never-saved')).record);
            assertEqual(0, sql.exec('SELECT count(*) AS n FROM releases').one().n);
        });

        it('stores and reads back a Release record with every field at its length cap', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            const input = releaseInput({
                createdBy: { type: 'user', id: 'i'.repeat(256), name: 'n'.repeat(256) },
                objectCount: Number.MAX_SAFE_INTEGER,
                totalBytes: Number.MAX_SAFE_INTEGER,
                provenance: {
                    sourceRevision: 'r'.repeat(256),
                    message: 'm'.repeat(2000),
                    client: 'c'.repeat(256),
                    intendedForBuildId: 'b'.repeat(256),
                },
            });

            const { record } = await core.recordRelease(input);

            assertEqual(JSON.stringify(input.createdBy), JSON.stringify(record.createdBy));
            assertEqual(JSON.stringify(input.provenance), JSON.stringify(record.provenance));
            assertEqual(Number.MAX_SAFE_INTEGER, record.objectCount);
            assertEqual(Number.MAX_SAFE_INTEGER, record.totalBytes);
        });

        it('rejects a malformed record and an empty release id', async () => {
            const { core, sql } = await makeCore();
            await core.saveIndex('root-1', makeIndex());

            const badRecord = await catchAsyncError(() => core.recordRelease(releaseInput({ objectCount: -1 })));
            const badId = await catchAsyncError(() => core.getRelease(''));

            assertEqual('AssertionError', badRecord.name);
            assertMatches('ContentAddressableIndexStore#recordRelease: release.objectCount', badRecord.message);
            assertMatches('ContentAddressableIndexStore#getRelease: releaseId', badId.message);
            assertEqual(0, sql.exec('SELECT count(*) AS n FROM releases').one().n);
        });
    });

    describe('listReleases', ({ it }) => {
        it('lists records stamped at one instant in reverse insertion order', async () => {
            const { core } = await makeCore({ now: () => Date.UTC(2027, 0, 15, 12) });
            for (const releaseId of [ 'root-1', 'root-2', 'root-3' ]) {
                await core.saveIndex(releaseId, makeIndex());
                await core.recordRelease(releaseInput({ releaseId }));
            }
            const ids = (page) => page.items.map((item) => item.releaseId).join(',');

            const all = await core.listReleases({ limit: 100 });
            const pageOne = await core.listReleases({ limit: 2, before: null });
            const pageTwo = await core.listReleases({ limit: 2, before: pageOne.nextSequence });

            assertEqual(true, all.success);
            assertEqual('root-3,root-2,root-1', ids(all));
            assertEqual(1, new Set(all.items.map((item) => item.createdAt)).size);
            assertEqual(null, all.nextSequence);
            assertEqual('root-3,root-2', ids(pageOne));
            assertEqual('root-1', ids(pageTwo));
            assertEqual(null, pageTwo.nextSequence);
        });

        it('rejects a malformed page', async () => {
            const { core } = await makeCore();

            for (const page of [ undefined, {}, { limit: 0 }, { limit: 101 }, { limit: 2, before: -1 } ]) {
                const caught = await catchAsyncError(() => core.listReleases(page));

                assert(caught, 'expected the page to reject');
                assertMatches('ContentAddressableIndexStore#listReleases: page', caught.message);
            }
        });
    });

    describe('listActivations', ({ it }) => {
        it('lists rows stamped at one instant in reverse insertion order', async () => {
            const { core } = await makeCore({ now: () => Date.UTC(2027, 0, 15, 12) });
            const assigned = [];
            for (const rootHash of [ 'root-1', 'root-2', 'root-3' ]) {
                await core.saveIndex(rootHash, makeIndex());
                assigned.push((await core.assignBuild('build-1', assignment({ rootHash }))).pointer.assignmentId);
            }

            const all = await core.listActivations({ limit: 100 });
            const pageOne = await core.listActivations({ buildId: 'build-1', limit: 2, before: null });
            const pageTwo = await core.listActivations({ buildId: 'build-1', limit: 2, before: pageOne.nextSequence });

            assertEqual(true, all.success);
            assertEqual(assigned.toReversed().join(','), all.items.map((item) => item.assignmentId).join(','));
            assertEqual(1, new Set(all.items.map((item) => item.activatedAt)).size);
            assertEqual(null, all.nextSequence);
            assertEqual(undefined, all.items[0].sequence);
            assertEqual('number', typeof pageOne.nextSequence);
            assertEqual(2, pageOne.items.length);
            assertEqual(assigned[0], pageTwo.items[0].assignmentId);
            assertEqual(1, pageTwo.items.length);
            assertEqual(null, pageTwo.nextSequence);
            assertEqual(0, (await core.listActivations({ buildId: 'other-build', limit: 2 })).items.length);
        });

        it('stores and reads back an Activation with every field at its length cap', async () => {
            const { core } = await makeCore();
            await core.saveIndex('root-1', makeIndex());
            const activation = {
                reason: 'carry-forward',
                actor: { type: 'user', id: 'i'.repeat(256), name: 'n'.repeat(256) },
                sourceRevision: 'r'.repeat(256),
                summary: 's'.repeat(2000),
                forceReason: 'f'.repeat(2000),
            };
            const code = { revision: 'c'.repeat(256), fingerprint: 'p'.repeat(256) };

            const assigned = await core.assignBuild('build-1', { rootHash: 'root-1', activation, code });
            const { items } = await core.listActivations({ limit: 1 });

            assertEqual(JSON.stringify(code), JSON.stringify(assigned.pointer.code));
            assertEqual(JSON.stringify(activation.actor), JSON.stringify(items[0].actor));
            assertEqual(activation.sourceRevision, items[0].sourceRevision);
            assertEqual(activation.summary, items[0].summary);
            assertEqual(activation.forceReason, items[0].forceReason);
            assertEqual('carry-forward', items[0].reason);
        });

        it('rejects a malformed page', async () => {
            const { core } = await makeCore();

            for (const page of [ undefined, {}, { limit: 0 }, { limit: 101 }, { limit: 2, before: 0 }, { limit: 2, before: '7' }, { limit: 2, buildId: '' } ]) {
                const caught = await catchAsyncError(() => core.listActivations(page));

                assert(caught, 'expected the page to reject');
                assertMatches('ContentAddressableIndexStore#listActivations: page', caught.message);
            }
        });
    });

    describe('durable storage', ({ it }) => {
        it('reads history written before a restart', async () => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kixx-cloudflare-history-'));
            const filename = path.join(directory, 'index.sqlite');
            let storage;
            try {
                storage = createFakeDurableObjectStorage({ path: filename });
                const first = new ContentAddressableIndexStoreCore({ ctx: createFakeDurableObjectState({ storage }), env: {} });
                await first.ready;
                await first.saveIndex('root-1', makeIndex());
                const assigned = await first.assignBuild('build-1', assignment({
                    rootHash: 'root-1',
                    code: { revision: 'revision-1', fingerprint: 'fingerprint-1' },
                }));
                const written = await first.listActivations({ limit: 100 });
                const recorded = await first.recordRelease(releaseInput());
                storage.close();

                storage = createFakeDurableObjectStorage({ path: filename });
                const reopened = new ContentAddressableIndexStoreCore({ ctx: createFakeDurableObjectState({ storage }), env: {} });
                await reopened.ready;

                assertEqual(JSON.stringify(assigned.pointer), JSON.stringify((await reopened.getBuildPointer('build-1')).pointer));
                assertEqual(JSON.stringify(written.items), JSON.stringify((await reopened.listActivations({ limit: 100 })).items));
                assertEqual(1, written.items.length);
                assertEqual(JSON.stringify(recorded.record), JSON.stringify((await reopened.getRelease('root-1')).record));
                assertEqual(1, (await reopened.listReleases({ limit: 100 })).items.length);
            } finally {
                storage?.close();
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });
    });

    describe('the closure cache', ({ it }) => {
        function changeClosure(sql, rootHash) {
            sql.exec("UPDATE closure_entries SET hash = 'changed' WHERE root_hash = ? AND pathname = '/a.txt'", rootHash);
        }

        async function readBlobHash(core, rootHash) {
            const { entries } = await core.getIndex(rootHash);
            return entries['/a.txt'][1];
        }

        it('serves a closure it has read from memory', async () => {
            const { core, sql } = await makeCore();
            await core.saveIndex('root-1', makeIndex('original'));
            await core.assignBuild('build-1', assignment({ rootHash: 'root-1' }));

            const first = await readBlobHash(core, 'root-1');
            changeClosure(sql, 'root-1');

            assertEqual('original', first);
            assertEqual('original', await readBlobHash(core, 'root-1'));
            assertEqual('original', (await core.getBuild('build-1')).entries['/a.txt'][1]);
        });

        it('keeps a closure that was read again and evicts the least recently used of 11', async () => {
            const { core, sql } = await makeCore();
            const rootHashes = Array.from({ length: 11 }, (_, index) => `root-${ index }`);
            for (const rootHash of rootHashes) {
                await core.saveIndex(rootHash, makeIndex('original'));
            }

            // Fill the cache with ten closures, oldest first.
            for (const rootHash of rootHashes.slice(0, 10)) {
                await readBlobHash(core, rootHash);
            }
            // Reading root-0 again makes root-1 the least recently used.
            await readBlobHash(core, 'root-0');
            changeClosure(sql, 'root-0');
            changeClosure(sql, 'root-1');
            // The eleventh closure pushes one out.
            await readBlobHash(core, 'root-10');

            assertEqual('original', await readBlobHash(core, 'root-0'));
            assertEqual('changed', await readBlobHash(core, 'root-1'));
        });
    });
});
