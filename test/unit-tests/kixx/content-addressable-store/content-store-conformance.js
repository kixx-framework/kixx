import { assert, assertEqual } from 'kixx-assert';


/**
 * @callback MakeContentStore
 * @returns {{ store: import('../../../../src/kixx/content-addressable-store/content-store-interface.js').ContentStoreInterface, context: Object, createStoreWithoutLogger: Function }}
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

        it('rejects unsupported read types and malformed blob arguments', async () => {
            const { store, context } = makeContentStore();

            await assertAssertionError(() => store.getFile(context, 'json', '/a.txt', 'hash-a'));
            await assertAssertionError(() => store.getFiles(context, 'arrayBuffer', [ { hash: 'hash-a' } ]));
            await assertAssertionError(() => store.getFile(context, 'text', '/a.txt', ''));
            await assertAssertionError(() => store.putFile(context, '/a.txt', '', 'text'));
            await assertAssertionError(() => store.putFile(context, '/a.txt', 'hash-a', new Uint8Array(1)));
            await assertAssertionError(() => store.getFiles(context, 'text', [ { hash: '' } ]));
        });
    });

    describe('contract: index closures and builds', ({ it }) => {
        it('saves immutable closures and preserves tree and blob tuple arity', async () => {
            const { store, context } = makeContentStore();
            const entries = {
                '/': [ 'tree', 'root-hash' ],
                '/a.txt': [ 'blob', 'blob-hash', 1, { language: 'en' } ],
            };

            await store.saveIndex(context, 'root-hash', entries);
            await store.saveIndex(context, 'root-hash', { '/': [ 'tree', 'replacement' ] });
            const outcome = await store.assignBuild(context, 'build-1', { rootHash: 'root-hash' });

            const build = await store.getBuild(context, 'build-1');

            assertEqual('assigned', outcome);
            assertEqual('root-hash', build.rootHash);
            assertEqual(2, build.entries['/'].length);
            assertEqual(4, build.entries['/a.txt'].length);
            assertEqual(JSON.stringify(entries), JSON.stringify(build.entries));
        });

        it('resolves null for a missing build and reports a missing closure without mutation', async () => {
            const { store, context } = makeContentStore();

            assertEqual(null, await store.getBuild(context, 'missing-build'));
            assertEqual('missingClosure', await store.assignBuild(context, 'build-1', { rootHash: 'missing-hash' }));
            assertEqual(null, await store.getBuild(context, 'build-1'));
        });

        it('permits unconditional reassignment to a different closure', async () => {
            const { store, context } = makeContentStore();
            const first = { '/': [ 'tree', 'first-hash' ] };
            const second = { '/': [ 'tree', 'second-hash' ] };

            await store.saveIndex(context, 'first-hash', first);
            await store.saveIndex(context, 'second-hash', second);
            await store.assignBuild(context, 'build-1', { rootHash: 'first-hash' });
            await store.assignBuild(context, 'build-1', { rootHash: 'second-hash' });

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
            await store.assignBuild(context, 'build-1', { rootHash: 'first-hash' });

            const stale = await store.assignBuild(context, 'build-1', {
                rootHash: 'second-hash',
                expectedRootHash: 'wrong-hash',
            });
            assertEqual('conflict', stale);
            assertEqual('first-hash', (await store.getBuild(context, 'build-1')).rootHash);

            const matched = await store.assignBuild(context, 'build-1', {
                rootHash: 'second-hash',
                expectedRootHash: 'first-hash',
            });
            assertEqual('assigned', matched);
            assertEqual('second-hash', (await store.getBuild(context, 'build-1')).rootHash);
        });

        it('reports a missing closure rather than conflict when the desired root does not exist', async () => {
            const { store, context } = makeContentStore();
            await store.saveIndex(context, 'first-hash', { '/': [ 'tree', 'first-hash' ] });
            await store.assignBuild(context, 'build-1', { rootHash: 'first-hash' });

            const outcome = await store.assignBuild(context, 'build-1', {
                rootHash: 'never-saved-hash',
                expectedRootHash: 'first-hash',
            });

            assertEqual('missingClosure', outcome);
            assertEqual('first-hash', (await store.getBuild(context, 'build-1')).rootHash);
        });

        it('rejects malformed index and build identifiers', async () => {
            const { store, context } = makeContentStore();

            await assertAssertionError(() => store.getBuild(context, ''));
            await assertAssertionError(() => store.saveIndex(context, '', { '/': [ 'tree', 'root-hash' ] }));
            await assertAssertionError(() => store.assignBuild(context, '', { rootHash: 'root-hash' }));
            await assertAssertionError(() => store.assignBuild(context, 'build-1', { rootHash: '' }));
        });
    });
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
