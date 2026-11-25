import { assert, assertEqual } from '../../../kixx/assertions/mod.js';


/**
 * @callback MakeContentStore
 * @returns {{ store: import('../../../kixx/content-addressable-store/content-store-interface.js').ContentStoreInterface, context: Object, createStoreWithoutLogger: Function }}
 */

/**
 * Shared observable contract for ContentStore adapters.
 *
 * The factory absorbs each platform's backing bindings and construction
 * details. This suite deliberately avoids caching, retry, and durability
 * guarantees that are not portable across adapters.
 *
 * @param {Function} describe - Nested describe handle from the adapter suite.
 * @param {MakeContentStore} makeContentStore - Creates an isolated store and context.
 */
export default function contentStoreConformance(describe, makeContentStore) {

    describe('contract: construction', ({ it }) => {
        it('requires a logger', async () => {
            const { createStoreWithoutLogger } = makeContentStore();

            await assertAssertionError(createStoreWithoutLogger);
        });
    });

    describe('contract: blob reads and writes', ({ it }) => {
        it('stores text by hash, ignoring pathname, and reports UTF-8 byte size', async () => {
            const { store, context } = makeContentStore();

            const size = await store.putFile(context, '/source.txt', 'text-hash', '👋');
            const value = await store.getFile(context, 'text', '/different.txt', 'text-hash');

            assertEqual(4, size);
            assertEqual('👋', value);
        });

        it('stores and reads ArrayBuffer payloads', async () => {
            const { store, context } = makeContentStore();
            const source = new TextEncoder().encode('bytes').buffer;

            await store.putFile(context, '/source.bin', 'bytes-hash', source);
            const result = await store.getFile(context, 'arrayBuffer', '/other.bin', 'bytes-hash');

            assertEqual('bytes', new TextDecoder().decode(result));
        });

        it('reads blobs as a Web stream', async () => {
            const { store, context } = makeContentStore();

            await store.putFile(context, '/source.txt', 'stream-hash', 'stream text');
            const stream = await store.getFile(context, 'stream', '/other.txt', 'stream-hash');

            assert(stream instanceof ReadableStream);
            assertEqual('stream text', await new Response(stream).text());
        });

        it('returns null for a missing blob', async () => {
            const { store, context } = makeContentStore();

            assertEqual(null, await store.getFile(context, 'text', '/missing.txt', 'missing-hash'));
        });

        it('keeps bulk results aligned, including missing and duplicate hashes', async () => {
            const { store, context } = makeContentStore();

            await store.putFile(context, '/a.txt', 'hash-a', 'A');
            await store.putFile(context, '/b.txt', 'hash-b', 'B');

            const results = await store.getFiles(context, 'text', [
                { hash: 'hash-b' },
                { hash: 'missing-hash' },
                { hash: 'hash-a' },
                { hash: 'hash-b' },
            ]);

            assertEqual('B,,A,B', results.join(','));
        });

        it('accepts exactly 100 bulk descriptors and rejects a larger list', async () => {
            const { store, context } = makeContentStore();
            const allowed = Array.from({ length: 100 }, (_, index) => ({ hash: `hash-${ index }` }));
            const rejected = [ ...allowed, { hash: 'one-too-many' } ];

            assertEqual(100, (await store.getFiles(context, 'text', allowed)).length);
            await assertAssertionError(() => store.getFiles(context, 'text', rejected));
        });

        it('reports stored sizes with missing and duplicate hashes aligned', async () => {
            const { store, context } = makeContentStore();

            await store.putFile(context, '/a.txt', 'hash-a', 'A');
            await store.putFile(context, '/wave.txt', 'hash-wave', '👋');
            const results = await store.statFiles(context, [
                'hash-wave',
                'missing-hash',
                'hash-a',
                'hash-wave',
            ]);

            assertEqual(JSON.stringify([ { size: 4 }, null, { size: 1 }, { size: 4 } ]), JSON.stringify(results));
        });

        // An upload is idempotent, so a store must absorb any limit its
        // platform puts on rewriting a key. No pause separates the two calls.
        it('accepts one hash uploaded twice in a row', async () => {
            const { store, context } = makeContentStore();
            const hash = `twice-${ crypto.randomUUID() }`;

            const first = await store.putFile(context, '/twice.txt', hash, 'twice');
            const second = await store.putFile(context, '/twice.txt', hash, 'twice');

            assertEqual(5, first);
            assertEqual(5, second);
            assertEqual('twice', await store.getFile(context, 'text', '/twice.txt', hash));
            assertEqual(JSON.stringify([ { size: 5 } ]), JSON.stringify(await store.statFiles(context, [ hash ])));
        });

        it('resolves an empty array for an empty bulk read', async () => {
            const { store, context } = makeContentStore();

            const results = await store.getFiles(context, 'text', []);

            assert(Array.isArray(results));
            assertEqual(0, results.length);
        });

        it('resolves an empty array for an empty bulk stat', async () => {
            const { store, context } = makeContentStore();

            const results = await store.statFiles(context, []);

            assert(Array.isArray(results));
            assertEqual(0, results.length);
        });

        it('accepts exactly 100 stat hashes and rejects a larger list', async () => {
            const { store, context } = makeContentStore();
            const allowed = Array.from({ length: 100 }, (_, index) => `hash-${ index }`);

            assertEqual(100, (await store.statFiles(context, allowed)).length);
            await assertAssertionError(() => store.statFiles(context, [ ...allowed, 'one-too-many' ]));
        });

        it('rejects unsupported read types and malformed blob arguments', async () => {
            const { store, context } = makeContentStore();

            await assertAssertionError(() => store.getFile(context, 'json', '/a.txt', 'hash-a'));
            await assertAssertionError(() => store.getFiles(context, 'arrayBuffer', [ { hash: 'hash-a' } ]));
            await assertAssertionError(() => store.getFile(context, 'text', '/a.txt', ''));
            await assertAssertionError(() => store.putFile(context, '/a.txt', '', 'text'));
            await assertAssertionError(() => store.putFile(context, '/a.txt', 'hash-a', new Uint8Array(1)));
            await assertAssertionError(() => store.getFiles(context, 'text', [ { hash: '' } ]));
            await assertAssertionError(() => store.statFiles(context, [ '' ]));
        });
    });

    describe('contract: index closures and builds', ({ it }) => {
        it('reads and lists pointers without closure entries', async () => {
            const { store, context } = makeContentStore();

            assertEqual(null, await store.getBuildPointer(context, 'missing-build'));
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.saveIndex(context, 'second-hash', { '/': [ 'tree', 'second-hash' ] });
            await store.assignBuild(context, 'build-b', assignment({ rootHash: 'first-hash' }));
            await store.assignBuild(context, 'build-a', assignment({ rootHash: 'second-hash' }));

            const pointer = await store.getBuildPointer(context, 'build-a');
            const builds = await store.listBuilds(context);

            assertEqual('second-hash', pointer.rootHash);
            assert(typeof pointer.assignedAt === 'string');
            assertEqual(undefined, pointer.entries);
            assertEqual(2, builds.length);
            assertEqual('build-a,build-b', builds.map(({ buildId }) => buildId).sort().join(','));
            assert(builds[0].assignedAt >= builds[1].assignedAt);
            assertEqual(undefined, builds[0].entries);
        });

        it('rejects the original identity after A to B to A', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.saveIndex(context, 'second-hash', { '/': [ 'tree', 'second-hash' ] });
            const first = await store.assignBuild(context, 'build', assignment({ rootHash: 'first-hash', expectedAssignmentId: null }));
            const second = await store.assignBuild(context, 'build', assignment({
                rootHash: 'second-hash', expectedAssignmentId: first.pointer.assignmentId,
            }));
            const third = await store.assignBuild(context, 'build', assignment({
                rootHash: 'first-hash', expectedAssignmentId: second.pointer.assignmentId,
            }));
            const stale = await store.assignBuild(context, 'build', assignment({
                rootHash: 'first-hash', expectedAssignmentId: first.pointer.assignmentId,
            }));

            assertEqual(3, new Set([ first, second, third ].map((result) => result.pointer.assignmentId)).size);
            assertEqual('conflict', stale.outcome);
            assertEqual(third.pointer.assignmentId, (await store.getBuildPointer(context, 'build')).assignmentId);
            assertEqual(third.pointer.assignmentId, (await store.listBuilds(context))[0].assignmentId);
            assertEqual('first-hash', first.pointer.rootHash);
            assertEqual(null, first.previousRootHash);
        });

        it('rejects removed hash preconditions instead of writing unconditionally', async () => {
            const { store, context } = makeContentStore();
            await assertAssertionError(() => store.assignBuild(context, 'build', assignment({
                rootHash: 'first-hash', expectedRootHash: null,
            })));
        });

        it('rejects malformed assignment identities', async () => {
            const { store, context } = makeContentStore();
            for (const expectedAssignmentId of [ '', 'first-hash', 1, {}, false ]) {
                await assertAssertionError(() => store.assignBuild(context, 'build', assignment({
                    rootHash: 'first-hash', expectedAssignmentId,
                })));
            }
        });

        it('assigns only an unassigned build when expectedAssignmentId is null', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.saveIndex(context, 'second-hash', { '/': [ 'tree', 'second-hash' ] });

            const assigned = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'first-hash',
                expectedAssignmentId: null,
            }));
            const conflict = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'second-hash',
                expectedAssignmentId: null,
            }));

            assertEqual('assigned', assigned.outcome);
            assertEqual('conflict', conflict.outcome);
            assertEqual('first-hash', (await store.getBuildPointer(context, 'build-1')).rootHash);
        });

        it('saves immutable closures and preserves tree and blob tuple arity', async () => {
            const { store, context } = makeContentStore();
            const entries = {
                '/': [ 'tree', 'root-hash' ],
                '/a.txt': [ 'blob', 'blob-hash', 1, { language: 'en' } ],
            };

            await store.saveIndex(context, 'root-hash', entries);
            await store.saveIndex(context, 'root-hash', { '/': [ 'tree', 'replacement' ] });
            const outcome = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'root-hash' }));

            const build = await store.getBuild(context, 'build-1');
            const closure = await store.getIndex(context, 'root-hash');

            assertEqual('assigned', outcome.outcome);
            assertEqual(JSON.stringify(build.entries), JSON.stringify(closure));
            assertEqual('root-hash', build.rootHash);
            assertEqual(2, build.entries['/'].length);
            assertEqual(4, build.entries['/a.txt'].length);
            assertEqual(JSON.stringify(entries), JSON.stringify(build.entries));
        });

        it('resolves null for a missing build and reports a missing closure without mutation', async () => {
            const { store, context } = makeContentStore();

            assertEqual(null, await store.getBuild(context, 'missing-build'));
            assertEqual('missingClosure', (await store.assignBuild(context, 'build-1', assignment({ rootHash: 'missing-hash' }))).outcome);
            assertEqual(null, await store.getBuild(context, 'build-1'));
        });

        it('permits unconditional reassignment to a different closure', async () => {
            const { store, context } = makeContentStore();
            const first = { '/': [ 'tree', 'first-hash' ] };
            const second = { '/': [ 'tree', 'second-hash' ] };

            await store.saveIndex(context, 'first-hash', first);
            await store.saveIndex(context, 'second-hash', second);
            await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash' }));
            await store.assignBuild(context, 'build-1', assignment({ rootHash: 'second-hash' }));

            const build = await store.getBuild(context, 'build-1');
            assertEqual('second-hash', build.rootHash);
            assertEqual(JSON.stringify(second), JSON.stringify(build.entries));
        });

        it('assigns conditionally when the expected pointer matches, and leaves it untouched on conflict', async () => {
            const { store, context } = makeContentStore();
            const first = { '/': [ 'tree', 'first-hash' ] };
            const second = { '/': [ 'tree', 'second-hash' ] };

            await store.saveIndex(context, 'first-hash', first);
            await store.saveIndex(context, 'second-hash', second);
            await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash' }));

            const stale = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'second-hash',
                expectedAssignmentId: crypto.randomUUID(),
            }));
            assertEqual('conflict', stale.outcome);
            assertEqual('first-hash', (await store.getBuild(context, 'build-1')).rootHash);

            const matched = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'second-hash',
                expectedAssignmentId: (await store.getBuildPointer(context, 'build-1')).assignmentId,
            }));
            assertEqual('assigned', matched.outcome);
            assertEqual('second-hash', (await store.getBuild(context, 'build-1')).rootHash);
        });

        it('returns a preserved pointer for a valid same-target no-op', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'root-hash', { '/': [ 'tree', 'root-hash' ] });
            const assigned = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'root-hash' }));
            const unchanged = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'root-hash',
                expectedAssignmentId: assigned.pointer.assignmentId,
            }));

            assertEqual('assigned', assigned.outcome);
            assertEqual('unchanged', unchanged.outcome);
            assertEqual('root-hash', unchanged.pointer.rootHash);
            assertEqual(assigned.pointer.assignedAt, unchanged.pointer.assignedAt);
            assertEqual(assigned.pointer.assignmentId, unchanged.pointer.assignmentId);
            assertEqual('root-hash', unchanged.previousRootHash);
        });

        it('checks a same-target request against its explicit precondition', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'root-hash', { '/': [ 'tree', 'root-hash' ] });
            const assigned = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'root-hash' }));
            const conflict = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'root-hash',
                expectedAssignmentId: null,
            }));

            assertEqual('conflict', conflict.outcome);
            assertEqual(assigned.pointer.assignedAt, (await store.getBuildPointer(context, 'build-1')).assignedAt);
        });

        it('reports a missing closure rather than conflict when the desired root does not exist', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash' }));

            const outcome = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'never-saved-hash',
                expectedAssignmentId: (await store.getBuildPointer(context, 'build-1')).assignmentId,
            }));

            assertEqual('missingClosure', outcome.outcome);
            assertEqual('first-hash', (await store.getBuild(context, 'build-1')).rootHash);
        });

        it('rejects malformed index and build identifiers', async () => {
            const { store, context } = makeContentStore();

            await assertAssertionError(() => store.getBuild(context, ''));
            await assertAssertionError(() => store.saveIndex(context, '', { '/': [ 'tree', 'root-hash' ] }));
            await assertAssertionError(() => store.assignBuild(context, '', assignment({ rootHash: 'root-hash' })));
            await assertAssertionError(() => store.assignBuild(context, 'build-1', assignment({ rootHash: '' })));
            await assertAssertionError(() => store.getBuildPointer(context, ''));
        });
    });
}

/**
 * Publishing history contract: Release records, Activations, build code
 * info, and paging.
 *
 * Only adapters that implement the history methods run this export. It is
 * folded into the default export once every adapter implements them.
 *
 * @param {Function} describe - Nested describe handle from the adapter suite.
 * @param {MakeContentStore} makeContentStore - Creates an isolated, empty store and context.
 */
export function contentStoreHistoryConformance(describe, makeContentStore) {

    describe('contract: release records', ({ it }) => {
        it('records a Release once and keeps the first record', async () => {
            const { store, context } = makeContentStore();
            const input = releaseInput({
                releaseId: 'release-hash',
                provenance: {
                    sourceRevision: 'revision-1',
                    message: 'First publish',
                    client: 'test-client',
                    intendedForBuildId: 'build-1',
                },
            });
            await store.saveIndex(context, 'release-hash', { '/': [ 'tree', 'release-hash' ] });

            const created = await store.recordRelease(context, input);
            const repeated = await store.recordRelease(context, releaseInput({
                releaseId: 'release-hash',
                createdBy: { type: 'user', id: 'user-2', name: 'Ada Editor' },
                objectCount: 9,
                totalBytes: 900,
                provenance: { message: 'Second publish' },
            }));
            const read = await store.getRelease(context, 'release-hash');

            assertEqual('created', created.outcome);
            assertEqual('exists', repeated.outcome);
            for (const record of [ created.record, repeated.record, read ]) {
                assertEqual(
                    'contractVersion,createdAt,createdBy,objectCount,provenance,releaseId,totalBytes',
                    Object.keys(record).sort().join(','),
                );
                assertEqual('release-hash', record.releaseId);
                assertEqual(created.record.createdAt, record.createdAt);
                assertActor({ type: 'deploy-key', id: 'test-key', name: null }, record.createdBy);
                assertEqual(3, record.objectCount);
                assertEqual(120, record.totalBytes);
                assertEqual(2, record.contractVersion);
                assertEqual('client,intendedForBuildId,message,sourceRevision', Object.keys(record.provenance).sort().join(','));
                assertEqual('revision-1', record.provenance.sourceRevision);
                assertEqual('First publish', record.provenance.message);
                assertEqual('test-client', record.provenance.client);
                assertEqual('build-1', record.provenance.intendedForBuildId);
            }
            assertEqual(created.record.createdAt, new Date(created.record.createdAt).toISOString());
        });

        it('reports a missing closure and records nothing', async () => {
            const { store, context } = makeContentStore();

            const result = await store.recordRelease(context, releaseInput({ releaseId: 'never-saved-hash' }));

            assertEqual('missingClosure', result.outcome);
            assertEqual(undefined, result.record);
            assertEqual(null, await store.getRelease(context, 'never-saved-hash'));
            assertEqual(0, (await store.listReleases(context)).items.length);
        });

        it('resolves null for an unknown Release', async () => {
            const { store, context } = makeContentStore();

            assertEqual(null, await store.getRelease(context, 'unknown-hash'));
        });

        it('lists Releases newest first and pages through them once', async () => {
            const { store, context } = makeContentStore();
            const ids = (page) => page.items.map((item) => item.releaseId).join(',');

            const empty = await store.listReleases(context);
            assertEqual(0, empty.items.length);
            assertEqual(null, empty.cursor);

            for (const releaseId of [ 'hash-1', 'hash-2', 'hash-3' ]) {
                await store.saveIndex(context, releaseId, { '/': [ 'tree', releaseId ] });
                await store.recordRelease(context, releaseInput({ releaseId }));
            }

            const everything = await store.listReleases(context);
            assertEqual('hash-3,hash-2,hash-1', ids(everything));
            assertEqual(null, everything.cursor);

            const pageOne = await store.listReleases(context, { limit: 2 });
            const pageTwo = await store.listReleases(context, { limit: 2, cursor: pageOne.cursor });
            assertEqual('hash-3,hash-2', ids(pageOne));
            assertEqual('string', typeof pageOne.cursor);
            assertEqual('hash-1', ids(pageTwo));
            assertEqual(null, pageTwo.cursor);
        });

        it('rejects a malformed Release record and writes nothing', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'release-hash', { '/': [ 'tree', 'release-hash' ] });

            const malformed = [
                undefined,
                releaseInput({ releaseId: '' }),
                releaseInput({ releaseId: 'release-hash', createdBy: undefined }),
                releaseInput({ releaseId: 'release-hash', createdBy: { type: 'robot', id: 'key-1' } }),
                releaseInput({ releaseId: 'release-hash', objectCount: -1 }),
                releaseInput({ releaseId: 'release-hash', totalBytes: 1.5 }),
                releaseInput({ releaseId: 'release-hash', contractVersion: 0 }),
                releaseInput({ releaseId: 'release-hash', provenance: { branch: 'main' } }),
                releaseInput({ releaseId: 'release-hash', createdAt: '2027-01-01T00:00:00.000Z' }),
            ];
            for (const badRelease of malformed) {
                await assertAssertionError(() => store.recordRelease(context, badRelease));
            }
            await assertAssertionError(() => store.getRelease(context, ''));

            assertEqual(null, await store.getRelease(context, 'release-hash'));
        });
    });

    describe('contract: history paging', ({ it }) => {
        it('rejects a malformed cursor as a bad request', async () => {
            const { store, context } = makeContentStore();

            for (const cursor of [ 'abc', '0', '01', '1.5' ]) {
                await assertInvalidCursor(() => store.listReleases(context, { cursor }));
                await assertInvalidCursor(() => store.listActivations(context, { cursor }));
            }
        });

        it('rejects a limit outside 1 to 100', async () => {
            const { store, context } = makeContentStore();

            for (const limit of [ 0, 101, 1.5, '10' ]) {
                await assertAssertionError(() => store.listReleases(context, { limit }));
                await assertAssertionError(() => store.listActivations(context, { limit }));
            }
        });
    });

    describe('contract: activations', ({ it }) => {
        it('appends one Activation for each changed assignment', async () => {
            const { store, context } = makeContentStore();
            const activation = {
                reason: 'rollback',
                actor: { type: 'user', id: 'user-1', name: 'Ada Editor' },
                sourceRevision: 'revision-1',
                summary: 'Fix the home page',
                forceReason: 'The live commit was rewritten',
            };
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.saveIndex(context, 'second-hash', { '/': [ 'tree', 'second-hash' ] });

            const first = await store.assignBuild(context, 'build-1', { rootHash: 'first-hash', activation });
            const second = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'second-hash' }));
            const page = await store.listActivations(context, { buildId: 'build-1' });

            assertEqual(2, page.items.length);
            assertEqual(null, page.cursor);
            assertActivation({
                buildId: 'build-1',
                assignmentId: first.pointer.assignmentId,
                fromReleaseId: null,
                toReleaseId: 'first-hash',
                activatedAt: first.pointer.assignedAt,
                ...activation,
            }, page.items[1]);
            assertEqual(second.pointer.assignmentId, page.items[0].assignmentId);
            assertEqual(second.pointer.assignedAt, page.items[0].activatedAt);
            assertEqual('first-hash', page.items[0].fromReleaseId);
            assertEqual('second-hash', page.items[0].toReleaseId);
        });

        it('reports optional Activation fields left out as null', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });

            const assigned = await store.assignBuild(context, 'build-1', {
                rootHash: 'first-hash',
                activation: { reason: 'publish', actor: { type: 'deploy-key', id: 'key-1' } },
            });
            const { items } = await store.listActivations(context);

            assertEqual(1, items.length);
            assertActivation({
                buildId: 'build-1',
                assignmentId: assigned.pointer.assignmentId,
                fromReleaseId: null,
                toReleaseId: 'first-hash',
                activatedAt: assigned.pointer.assignedAt,
                reason: 'publish',
                actor: { type: 'deploy-key', id: 'key-1', name: null },
                sourceRevision: null,
                summary: null,
                forceReason: null,
            }, items[0]);
        });

        it('appends nothing for an unchanged, conflicting, or missing-closure assignment', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.saveIndex(context, 'second-hash', { '/': [ 'tree', 'second-hash' ] });
            const assigned = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash' }));

            const unchanged = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash' }));
            assertEqual('unchanged', unchanged.outcome);
            assertEqual(1, (await store.listActivations(context)).items.length);

            const conflict = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'second-hash',
                expectedAssignmentId: null,
            }));
            assertEqual('conflict', conflict.outcome);
            assertEqual(1, (await store.listActivations(context)).items.length);

            const missing = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'never-saved-hash' }));
            assertEqual('missingClosure', missing.outcome);
            assertEqual(1, (await store.listActivations(context)).items.length);

            assertPointer(assigned.pointer, await store.getBuildPointer(context, 'build-1'));
        });

        it('lists Activations for one build and across builds, newest first, and pages through each once', async () => {
            const { store, context } = makeContentStore();
            for (const rootHash of [ 'hash-1', 'hash-2', 'hash-3' ]) {
                await store.saveIndex(context, rootHash, { '/': [ 'tree', rootHash ] });
            }
            const steps = [
                [ 'build-a', 'hash-1' ],
                [ 'build-b', 'hash-1' ],
                [ 'build-a', 'hash-2' ],
                [ 'build-b', 'hash-2' ],
                [ 'build-a', 'hash-3' ],
            ];
            const assigned = [];
            for (const [ buildId, rootHash ] of steps) {
                assigned.push((await store.assignBuild(context, buildId, assignment({ rootHash }))).pointer.assignmentId);
            }
            const newestFirst = assigned.toReversed();
            const ids = (page) => page.items.map((item) => item.assignmentId).join(',');

            const everything = await store.listActivations(context);
            assertEqual(newestFirst.join(','), ids(everything));
            assertEqual(null, everything.cursor);

            const forBuildA = await store.listActivations(context, { buildId: 'build-a' });
            assertEqual([ assigned[4], assigned[2], assigned[0] ].join(','), ids(forBuildA));
            assertEqual('hash-3,hash-2,hash-1', forBuildA.items.map((item) => item.toReleaseId).join(','));

            const pageOne = await store.listActivations(context, { limit: 2 });
            const pageTwo = await store.listActivations(context, { limit: 2, cursor: pageOne.cursor });
            const pageThree = await store.listActivations(context, { limit: 2, cursor: pageTwo.cursor });
            assertEqual('string', typeof pageOne.cursor);
            assertEqual('string', typeof pageTwo.cursor);
            assertEqual(null, pageThree.cursor);
            assertEqual(newestFirst.join(','), [ ids(pageOne), ids(pageTwo), ids(pageThree) ].join(','));

            const buildPageOne = await store.listActivations(context, { buildId: 'build-a', limit: 2 });
            const buildPageTwo = await store.listActivations(context, {
                buildId: 'build-a',
                limit: 2,
                cursor: buildPageOne.cursor,
            });
            assertEqual(null, buildPageTwo.cursor);
            assertEqual(ids(forBuildA), [ ids(buildPageOne), ids(buildPageTwo) ].join(','));

            // A page that holds exactly the rows left is the last page.
            const exactFit = await store.listActivations(context, { buildId: 'build-b', limit: 2 });
            assertEqual([ assigned[3], assigned[1] ].join(','), ids(exactFit));
            assertEqual(null, exactFit.cursor);

            const unknown = await store.listActivations(context, { buildId: 'unknown-build' });
            assertEqual(0, unknown.items.length);
            assertEqual(null, unknown.cursor);
        });

        it('rejects a malformed assignment and writes nothing', async () => {
            const { store, context } = makeContentStore();
            const actor = { type: 'deploy-key', id: 'key-1' };
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });

            const malformed = [
                { rootHash: 'first-hash' },
                { rootHash: 'first-hash', activation: { reason: 'deploy', actor } },
                { rootHash: 'first-hash', activation: { reason: 'publish' } },
                { rootHash: 'first-hash', activation: { reason: 'publish', actor: { type: 'robot', id: 'key-1' } } },
                { rootHash: 'first-hash', activation: { reason: 'publish', actor: { type: 'user', id: '' } } },
                { rootHash: 'first-hash', activation: { reason: 'publish', actor, summary: 'x'.repeat(2001) } },
                { rootHash: 'first-hash', activation: { reason: 'publish', actor, forceReson: 'misspelled' } },
                assignment({ rootHash: 'first-hash', code: { revision: 'revision-1' } }),
            ];
            for (const badAssignment of malformed) {
                await assertAssertionError(() => store.assignBuild(context, 'build-1', badAssignment));
            }

            assertEqual(null, await store.getBuildPointer(context, 'build-1'));
            assertEqual(0, (await store.listActivations(context)).items.length);
        });
    });

    describe('contract: build code info', ({ it }) => {
        it('sets code info once and refuses different values', async () => {
            const { store, context } = makeContentStore();
            const code = { revision: 'revision-1', fingerprint: 'fingerprint-1' };
            for (const rootHash of [ 'hash-1', 'hash-2', 'hash-3' ]) {
                await store.saveIndex(context, rootHash, { '/': [ 'tree', rootHash ] });
            }

            const first = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'hash-1', code }));
            assertEqual('assigned', first.outcome);
            assertCode(code, first.pointer.code);
            assertCode(code, (await store.getBuildPointer(context, 'build-1')).code);
            assertCode(code, (await store.listBuilds(context))[0].code);

            const omitted = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'hash-2' }));
            assertEqual('assigned', omitted.outcome);
            assertCode(code, omitted.pointer.code);

            const repeated = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'hash-3', code: { ...code } }));
            assertEqual('assigned', repeated.outcome);
            assertCode(code, repeated.pointer.code);

            const otherRevision = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'hash-1',
                code: { revision: 'revision-2', fingerprint: 'fingerprint-1' },
            }));
            assertEqual('codeMismatch', otherRevision.outcome);
            assertCode(code, otherRevision.code);

            // A mismatch is reported even when the target is already assigned.
            const otherFingerprint = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'hash-3',
                code: { revision: 'revision-1', fingerprint: 'fingerprint-2' },
            }));
            assertEqual('codeMismatch', otherFingerprint.outcome);
            assertCode(code, otherFingerprint.code);

            assertPointer(repeated.pointer, await store.getBuildPointer(context, 'build-1'));
            assertEqual(3, (await store.listActivations(context)).items.length);
        });

        it('stores missing code info on a same-target assignment without a new Activation', async () => {
            const { store, context } = makeContentStore();
            const code = { revision: 'revision-1', fingerprint: 'fingerprint-1' };
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });

            const assigned = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash' }));
            assertEqual(null, assigned.pointer.code);
            assertEqual(null, (await store.getBuildPointer(context, 'build-1')).code);
            assertEqual(null, (await store.listBuilds(context))[0].code);

            const unchanged = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash', code }));
            assertEqual('unchanged', unchanged.outcome);
            assertEqual(assigned.pointer.assignedAt, unchanged.pointer.assignedAt);
            assertEqual(assigned.pointer.assignmentId, unchanged.pointer.assignmentId);
            assertCode(code, unchanged.pointer.code);

            const pointer = await store.getBuildPointer(context, 'build-1');
            assertEqual(assigned.pointer.assignedAt, pointer.assignedAt);
            assertEqual(assigned.pointer.assignmentId, pointer.assignmentId);
            assertCode(code, pointer.code);
            assertEqual(1, (await store.listActivations(context)).items.length);
        });

        it('reports a missing closure before a conflict, and a conflict before a code mismatch', async () => {
            const { store, context } = makeContentStore();
            const code = { revision: 'revision-1', fingerprint: 'fingerprint-1' };
            const otherCode = { revision: 'revision-2', fingerprint: 'fingerprint-2' };
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.saveIndex(context, 'second-hash', { '/': [ 'tree', 'second-hash' ] });
            const assigned = await store.assignBuild(context, 'build-1', assignment({ rootHash: 'first-hash', code }));

            const missing = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'never-saved-hash',
                expectedAssignmentId: crypto.randomUUID(),
                code: otherCode,
            }));
            const conflict = await store.assignBuild(context, 'build-1', assignment({
                rootHash: 'second-hash',
                expectedAssignmentId: crypto.randomUUID(),
                code: otherCode,
            }));

            assertEqual('missingClosure', missing.outcome);
            assertEqual('conflict', conflict.outcome);
            assertPointer(assigned.pointer, await store.getBuildPointer(context, 'build-1'));
            assertEqual(1, (await store.listActivations(context)).items.length);
        });
    });
}

// Every existing assignment needs an Activation; most cases do not care what
// it says.
function assignment(fields) {
    return {
        activation: { reason: 'publish', actor: { type: 'deploy-key', id: 'test-key' } },
        ...fields,
    };
}

function releaseInput(fields) {
    return {
        createdBy: { type: 'deploy-key', id: 'test-key' },
        objectCount: 3,
        totalBytes: 120,
        contractVersion: 2,
        provenance: {},
        ...fields,
    };
}

function assertPointer(expected, actual) {
    assertEqual(expected.rootHash, actual.rootHash);
    assertEqual(expected.assignedAt, actual.assignedAt);
    assertEqual(expected.assignmentId, actual.assignmentId);
}

function assertCode(expected, actual) {
    assertEqual('fingerprint,revision', Object.keys(actual).sort().join(','));
    assertEqual(expected.revision, actual.revision);
    assertEqual(expected.fingerprint, actual.fingerprint);
}

function assertActivation(expected, actual) {
    assertEqual(
        'activatedAt,actor,assignmentId,buildId,forceReason,fromReleaseId,reason,sourceRevision,summary,toReleaseId',
        Object.keys(actual).sort().join(','),
    );
    for (const key of [ 'buildId', 'assignmentId', 'fromReleaseId', 'toReleaseId', 'activatedAt', 'reason', 'sourceRevision', 'summary', 'forceReason' ]) {
        assertEqual(expected[key], actual[key], key);
    }
    assertActor(expected.actor, actual.actor);
}

function assertActor(expected, actual) {
    assertEqual('id,name,type', Object.keys(actual).sort().join(','));
    assertEqual(expected.type, actual.type);
    assertEqual(expected.id, actual.id);
    assertEqual(expected.name ?? null, actual.name);
}

async function assertInvalidCursor(fn) {
    try {
        await fn();
    } catch (error) {
        assertEqual('BadRequestError', error.name);
        assertEqual('InvalidCursor', error.code);
        assertEqual(400, error.httpStatusCode);
        return;
    }

    assert(false, 'expected a BadRequestError');
}

async function assertAssertionError(fn) {
    try {
        await fn();
    } catch (error) {
        assertEqual('AssertionError', error.name);
        return;
    }

    assert(false, 'expected an AssertionError');
}
