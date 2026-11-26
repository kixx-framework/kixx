import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentStore from '../../../../../../kixx/adapters/node/content-store/lib/content-store.js';
import Logger from '../../../../../../kixx/logger/logger.js';
import contentStoreConformance from '../../../../content-addressable-store/content-store-conformance.js';


const temporaryDirectories = [];

async function makeTemporaryDirectory() {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-content-store-'));
    temporaryDirectories.push(directory);
    return directory;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeContext() {
    return { logger: makeLogger() };
}

function makeStore(rootDirectory, options = {}) {
    return new ContentStore({
        logger: makeLogger(),
        rootDirectory,
        format: 4,
        ...options,
    });
}

function releaseInput(releaseId) {
    return {
        releaseId,
        createdBy: { type: 'deploy-key', id: 'test-key' },
        objectCount: 1,
        totalBytes: 10,
        contractVersion: 2,
        provenance: {},
    };
}

// Every assignment needs an Activation; most tests do not care what it says.
function assignment(fields) {
    return {
        activation: { reason: 'publish', actor: { type: 'deploy-key', id: 'test-key' } },
        ...fields,
    };
}

function makeConformanceStore() {
    const rootDirectory = path.join(os.tmpdir(), `kixx-content-store-contract-${ randomUUID() }`);
    temporaryDirectories.push(rootDirectory);
    return {
        store: makeStore(rootDirectory),
        context: makeContext(),
        createStoreWithoutLogger: () => new ContentStore({ rootDirectory, format: 4 }),
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Node ContentStore', ({ after, describe }) => {

    after(async () => {
        for (const directory of temporaryDirectories) {
            await fsp.rm(directory, { recursive: true, force: true });
        }
    });

    contentStoreConformance(describe, makeConformanceStore);

    describe('construction', ({ it }) => {
        it('requires a logger, root directory, and positive format', () => {
            const missingLogger = catchError(() => new ContentStore({ rootDirectory: '/tmp', format: 4 }));
            const missingDirectory = catchError(() => new ContentStore({ logger: makeLogger(), format: 4 }));
            const invalidFormat = catchError(() => new ContentStore({ logger: makeLogger(), rootDirectory: '/tmp', format: 0 }));

            assertEqual('AssertionError', missingLogger.name);
            assertEqual('AssertionError', missingDirectory.name);
            assertEqual('AssertionError', invalidFormat.name);
        });
    });

    describe('durable storage', ({ it }) => {
        it('reopens format four without changing assignment identity', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);
            await store.saveIndex(makeContext(), 'root', { '/': [ 'tree', 'root' ] });
            const recorded = await store.recordRelease(makeContext(), releaseInput('root'));
            const assigned = await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'root' }));
            store.close();

            const reopened = makeStore(rootDirectory);
            const pointer = await reopened.getBuildPointer(makeContext(), 'build');
            assertEqual(JSON.stringify(assigned.pointer), JSON.stringify(pointer));
            assertEqual(JSON.stringify(recorded.record), JSON.stringify(await reopened.getRelease(makeContext(), 'root')));
            assertEqual(1, (await reopened.listReleases(makeContext())).items.length);
            const { items } = await reopened.listActivations(makeContext(), { buildId: 'build' });
            assertEqual(1, items.length);
            assertEqual(assigned.pointer.assignmentId, items[0].assignmentId);
            assertEqual('root', items[0].toReleaseId);
            const database = new DatabaseSync(path.join(rootDirectory, 'format-4', 'index.sqlite'));
            assertEqual(0, database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'pending_build_assignments%'").get().count);
            database.close();
            reopened.close();
        });

        it('reopens a store which retains an unused table from an earlier schema', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);
            await store.saveIndex(makeContext(), 'root', { '/': [ 'tree', 'root' ] });
            const assigned = await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'root' }));
            store.close();

            const database = new DatabaseSync(path.join(rootDirectory, 'format-4', 'index.sqlite'));
            database.exec('CREATE TABLE pending_build_assignments (sequence INTEGER PRIMARY KEY AUTOINCREMENT)');
            database.close();

            const reopened = makeStore(rootDirectory);
            const pointer = await reopened.getBuildPointer(makeContext(), 'build');

            assertEqual(assigned.pointer.assignmentId, pointer.assignmentId);
            reopened.close();
        });

        it('uses the format namespace and two-character blob shard', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory, { format: 7 });

            await store.putFile(makeContext(), '/ignored.txt', 'abcdef', 'content');

            const filePath = path.join(rootDirectory, 'format-7', 'blobs', 'ab', 'abcdef');
            assertEqual('content', await fsp.readFile(filePath, 'utf8'));
            assertEqual(1, (await fsp.readdir(path.dirname(filePath))).length);
            store.close();
        });

        it('removes its staged temporary file after publishing a blob', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.putFile(makeContext(), '/', 'abcdef', 'content');

            const shardDirectory = path.join(rootDirectory, 'format-4', 'blobs', 'ab');
            assertEqual(JSON.stringify([ 'abcdef' ]), JSON.stringify(await fsp.readdir(shardDirectory)));
            store.close();
        });

        it('closes a blob stream when a caller cancels it', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.putFile(makeContext(), '/', 'stream', 'content');
            const stream = await store.getFile(makeContext(), 'stream', '/', 'stream');
            await stream.cancel();

            assertEqual('content', await store.getFile(makeContext(), 'text', '/', 'stream'));
            store.close();
        });

        it('persists closures and makes reassignment immediately visible across instances', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const first = makeStore(rootDirectory);
            const second = makeStore(rootDirectory);
            const firstEntries = { '/': [ 'tree', 'first' ] };
            const secondEntries = { '/': [ 'tree', 'second' ] };

            await first.saveIndex(makeContext(), 'first', firstEntries);
            await first.saveIndex(makeContext(), 'second', secondEntries);
            await first.assignBuild(makeContext(), 'current', assignment({ rootHash: 'first' }));
            await second.assignBuild(makeContext(), 'current', assignment({ rootHash: 'second' }));

            const build = await first.getBuild(makeContext(), 'current');
            assertEqual('second', build.rootHash);
            assertEqual(JSON.stringify(secondEntries), JSON.stringify(build.entries));
            first.close();
            second.close();
        });

        it('conditionally assigns across instances using a stale-pointer conflict as the CAS proof', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const first = makeStore(rootDirectory);
            const second = makeStore(rootDirectory);

            await first.saveIndex(makeContext(), 'first', { '/': [ 'tree', 'first' ] });
            await first.saveIndex(makeContext(), 'second', { '/': [ 'tree', 'second' ] });
            const original = await first.assignBuild(makeContext(), 'current', assignment({ rootHash: 'first' }));

            // A second instance moves the pointer between when a caller could
            // have observed "first" and when it tries to restore it, the same
            // way a concurrent deploy or test run would.
            const replacement = await second.assignBuild(makeContext(), 'current', assignment({ rootHash: 'second' }));

            const conflicted = await first.assignBuild(makeContext(), 'current', assignment({
                rootHash: 'first',
                expectedAssignmentId: original.pointer.assignmentId,
            }));
            assertEqual('conflict', conflicted.outcome);
            assertEqual('second', (await first.getBuild(makeContext(), 'current')).rootHash);

            const assigned = await first.assignBuild(makeContext(), 'current', assignment({
                rootHash: 'first',
                expectedAssignmentId: replacement.pointer.assignmentId,
            }));
            assertEqual('assigned', assigned.outcome);
            assertEqual('first', (await second.getBuild(makeContext(), 'current')).rootHash);

            first.close();
            second.close();
        });

        it('preserves a seeded pointer timestamp for a same-target no-op', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);
            await store.saveIndex(makeContext(), 'root', { '/': [ 'tree', 'root' ] });
            await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'root' }));

            const database = new DatabaseSync(path.join(rootDirectory, 'format-4', 'index.sqlite'));
            database.prepare('UPDATE builds SET assigned_at = ? WHERE build_id = ?').run('2000-01-01T00:00:00.000Z', 'build');
            database.close();

            const result = await store.assignBuild(makeContext(), 'build', assignment({
                rootHash: 'root',
                expectedAssignmentId: (await store.getBuildPointer(makeContext(), 'build')).assignmentId,
            }));

            assertEqual('unchanged', result.outcome);
            assertEqual('2000-01-01T00:00:00.000Z', result.pointer.assignedAt);
            assertEqual('root', result.previousRootHash);
            store.close();
        });

        it('rolls back a failed commit and leaves the connection usable', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const database = new DatabaseSync(':memory:');
            let failCommit = false;
            const failingDatabase = {
                exec(statement) {
                    if (statement === 'COMMIT' && failCommit) {
                        failCommit = false;
                        throw new Error('injected commit failure');
                    }
                    return database.exec(statement);
                },
                prepare(statement) {
                    return database.prepare(statement);
                },
            };
            const store = makeStore(rootDirectory, { database: failingDatabase });

            await store.saveIndex(makeContext(), 'root', { '/': [ 'tree', 'root' ] });
            failCommit = true;
            const failed = await catchAsyncError(() => store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'root' })));
            assertEqual(null, await store.getBuildPointer(makeContext(), 'build'));
            const assigned = await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'root' }));

            assertEqual('OperationalError', failed.name);
            assertEqual('assigned', assigned.outcome);
            store.close();
            database.close();
        });

        it('rolls back the pointer when its Activation cannot be written', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            // activations.assignment_id is unique, so a repeated identity
            // fails the Activation insert after the pointer was written.
            const store = makeStore(rootDirectory, { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
            await store.saveIndex(makeContext(), 'first', { '/': [ 'tree', 'first' ] });
            await store.saveIndex(makeContext(), 'second', { '/': [ 'tree', 'second' ] });
            const first = await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'first' }));

            const failed = await catchAsyncError(() => store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'second' })));

            const pointer = await store.getBuildPointer(makeContext(), 'build');
            const { items } = await store.listActivations(makeContext());
            assertEqual('OperationalError', failed.name);
            assert(failed.cause);
            assertEqual('first', pointer.rootHash);
            assertEqual(first.pointer.assignedAt, pointer.assignedAt);
            assertEqual(first.pointer.assignmentId, pointer.assignmentId);
            assertEqual(1, items.length);
            assertEqual('first', items[0].toReleaseId);
            store.close();
        });

        it('stamps history from the injected clock and lists same-instant rows in reverse insertion order', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const instant = Date.UTC(2027, 0, 15, 12, 30, 0);
            const store = makeStore(rootDirectory, { now: () => instant });
            for (const rootHash of [ 'first', 'second', 'third' ]) {
                await store.saveIndex(makeContext(), rootHash, { '/': [ 'tree', rootHash ] });
                await store.recordRelease(makeContext(), releaseInput(rootHash));
            }

            const assigned = await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'first' }));
            await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'second' }));
            await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'third' }));

            const { items } = await store.listActivations(makeContext());
            assertEqual('2027-01-15T12:30:00.000Z', assigned.pointer.assignedAt);
            assertEqual('third,second,first', items.map((item) => item.toReleaseId).join(','));
            for (const item of items) {
                assertEqual('2027-01-15T12:30:00.000Z', item.activatedAt);
            }

            const releases = await store.listReleases(makeContext());
            assertEqual('third,second,first', releases.items.map((item) => item.releaseId).join(','));
            for (const item of releases.items) {
                assertEqual('2027-01-15T12:30:00.000Z', item.createdAt);
            }
            store.close();
        });

        it('initializes schema version five with required SQLite pragmas', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.getFile(makeContext(), 'text', '/', 'missing');

            const database = new DatabaseSync(path.join(rootDirectory, 'format-4', 'index.sqlite'));
            const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
            assertEqual(5, database.prepare('PRAGMA user_version').get().user_version);
            assertEqual(1, database.prepare('PRAGMA foreign_keys').get().foreign_keys);
            assertEqual('wal', database.prepare('PRAGMA journal_mode').get().journal_mode);
            assertEqual('activations,builds,closures,releases', tables.map(({ name }) => name).join(','));
            assertEqual(1, database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'activations_build'").get().count);
            database.close();
            store.close();
        });

        it('preserves an injected database for its caller by default', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const database = new DatabaseSync(':memory:');
            const store = makeStore(rootDirectory, { database });

            await store.saveIndex(makeContext(), 'root', { '/': [ 'tree', 'root' ] });
            store.close();

            assertEqual(1, database.prepare('SELECT COUNT(*) AS count FROM closures').get().count);
            database.close();
        });
    });

    describe('error boundaries and lifecycle', ({ it }) => {
        it('rejects hashes that cannot be used as a filesystem path segment', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            for (const hash of [ '.', '..', 'a/b', 'a\\b', 'a\u0000b' ]) {
                const caught = await catchAsyncError(() => store.getFile(makeContext(), 'text', '/', hash));
                assertEqual('AssertionError', caught.name);
            }
            store.close();
        });

        it('classifies corrupt stored JSON and newer schemas as assertion failures', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.saveIndex(makeContext(), 'root', { '/': [ 'tree', 'root' ] });
            await store.assignBuild(makeContext(), 'build', assignment({ rootHash: 'root' }));
            const database = new DatabaseSync(path.join(rootDirectory, 'format-4', 'index.sqlite'));
            database.prepare('UPDATE closures SET entries_json = ? WHERE root_hash = ?').run('{', 'root');
            database.close();

            const corrupt = await catchAsyncError(() => store.getBuild(makeContext(), 'build'));
            assertEqual('AssertionError', corrupt.name);
            assert(corrupt.cause);
            store.close();

            const newerDatabase = new DatabaseSync(':memory:');
            newerDatabase.exec('PRAGMA user_version = 6');
            const newerStore = makeStore(rootDirectory, { database: newerDatabase });
            const newer = await catchAsyncError(() => newerStore.getBuild(makeContext(), 'build'));
            assertEqual('AssertionError', newer.name);
            assertMatches('schema version 6 is newer than supported version 5', newer.message);
            assertEqual(6, newerDatabase.prepare('PRAGMA user_version').get().user_version);
            assertEqual(0, newerDatabase.prepare('SELECT COUNT(*) AS count FROM sqlite_master').get().count);
            newerStore.close();
            newerDatabase.close();
        });

        it('rejects every older schema instead of upgrading it', async () => {
            const rootDirectory = await makeTemporaryDirectory();

            for (const version of [ 1, 2, 3, 4 ]) {
                const database = new DatabaseSync(':memory:');
                database.exec(`PRAGMA user_version = ${ version }`);
                const store = makeStore(rootDirectory, { database });

                const caught = await catchAsyncError(() => store.listBuilds(makeContext()));

                assertEqual('AssertionError', caught.name);
                assertMatches(`does not migrate schema version ${ version } to 5`, caught.message);
                assertEqual(version, database.prepare('PRAGMA user_version').get().user_version);
                assertEqual(0, database.prepare('SELECT COUNT(*) AS count FROM sqlite_master').get().count);
                store.close();
                database.close();
            }
        });

        it('translates thrown index serialization failures to assertion errors', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);
            const entries = { '/': [ 'tree', 'root' ] };
            entries.self = entries;

            const caught = await catchAsyncError(() => store.saveIndex(makeContext(), 'root', entries));
            assertEqual('AssertionError', caught.name);
            assert(caught.cause);
            store.close();
        });

        it('permanently rejects operations after close', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            store.close();
            store.close();

            const caught = await catchAsyncError(() => store.getFile(makeContext(), 'text', '/', 'hash'));
            assertEqual('AssertionError', caught.name);
            assertMatches('has been closed', caught.message);
        });

        it('wraps filesystem initialization failures as operational errors', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const rootFile = path.join(rootDirectory, 'not-a-directory');
            await fsp.writeFile(rootFile, 'file');
            const store = makeStore(rootFile);

            const caught = await catchAsyncError(() => store.getFile(makeContext(), 'text', '/', 'hash'));
            assertEqual('OperationalError', caught.name);
            assert(caught.cause);
            store.close();
        });
    });
});
