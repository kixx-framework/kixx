import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ContentAddressableStore from '../../../../src/kixx/content-addressable-store/content-addressable-store.js';
import { getGlobalTemplatePartialsPath } from '../../../../src/kixx/content-addressable-store/content-layout.js';


// Records what the framework hands the adapter, and replays it back on read.
// Standing in for the whole persistence layer this way is what lets a single
// test assert that what commitChanges() writes is what openSnapshot() can read.
function makeContentStore() {
    const closures = new Map();
    const builds = new Map();
    const calls = [];

    return {
        closures,
        builds,
        calls,
        async saveIndex(_context, rootHash, entries) {
            calls.push('saveIndex');
            closures.set(rootHash, entries);
        },
        async assignBuild(_context, buildId, rootHash) {
            calls.push('assignBuild');
            builds.set(buildId, rootHash);
        },
        async getIndex(_context, buildId) {
            calls.push('getIndex');
            return closures.get(builds.get(buildId));
        },
        async getFile(_context, _type, _pathname, hash) {
            return `bytes:${ hash }`;
        },
    };
}

function makeStore(contentStore) {
    const store = new ContentAddressableStore();
    store.initialize({ contentStore });
    return store;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('ContentAddressableStore', ({ describe }) => {

    describe('initialize()', ({ it }) => {
        it('requires a ContentStore', () => {
            const store = new ContentAddressableStore();

            let caught = null;
            try {
                store.initialize({});
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('commitChanges()', ({ it }) => {
        it('saves the closure before pointing the build at it', async () => {
            const contentStore = makeContentStore();
            const store = makeStore(contentStore);

            await store.commitChanges({}, 'build-1', [
                { pathname: '/a.txt', hash: 'hash-a', size: 1 },
            ]);

            // Order matters: a build pointed at a closure that is not yet
            // durable would resolve to nothing for any reader that got there
            // first.
            assertEqual('saveIndex,assignBuild', contentStore.calls.join(','));
        });

        it('reports the root hash and node count of the committed closure', async () => {
            const contentStore = makeContentStore();
            const store = makeStore(contentStore);

            const result = await store.commitChanges({}, 'build-1', [
                { pathname: '/a.txt', hash: 'hash-a', size: 1 },
                { pathname: '/dir/b.txt', hash: 'hash-b', size: 2 },
            ]);

            // Two blobs plus the root and the "/dir" tree.
            assertEqual(4, result.nodeCount);
            assertEqual(contentStore.builds.get('build-1'), result.rootHash);
        });

        it('derives an identical root hash for identical content', async () => {
            const store = makeStore(makeContentStore());
            const files = [ { pathname: '/a.txt', hash: 'hash-a', size: 1 } ];

            const first = await store.commitChanges({}, 'build-1', files);
            const second = await store.commitChanges({}, 'build-2', files);

            assertEqual(first.rootHash, second.rootHash);
        });

        it('derives a different root hash when content changes', async () => {
            const store = makeStore(makeContentStore());

            const first = await store.commitChanges({}, 'build-1', [
                { pathname: '/a.txt', hash: 'hash-a', size: 1 },
            ]);
            const second = await store.commitChanges({}, 'build-2', [
                { pathname: '/a.txt', hash: 'hash-changed', size: 1 },
            ]);

            assert(first.rootHash !== second.rootHash, 'expected the root hash to change');
        });

        it('rejects a malformed file list', async () => {
            const store = makeStore(makeContentStore());

            const caught = await catchAsyncError(
                () => store.commitChanges({}, 'build-1', [ { pathname: '/a.txt' } ]),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });
    });

    describe('openSnapshot()', ({ it }) => {
        it('reads back a snapshot over the table that was committed', async () => {
            const contentStore = makeContentStore();
            const store = makeStore(contentStore);
            const partialsPath = getGlobalTemplatePartialsPath();

            await store.commitChanges({}, 'build-1', [
                { pathname: partialsPath, hash: 'hash-partials', size: 4 },
            ]);

            // The whole write-then-read contract in one assertion: whatever
            // commitChanges() encoded has to survive the store round trip in a
            // shape the index can be rebuilt from.
            const snapshot = await store.openSnapshot({
                runtime: { build: { id: 'build-1' } },
            });

            const stat = snapshot.statGlobalTemplatePartials();
            assert(stat, 'expected the committed partials bundle to be visible');
            assertEqual('hash-partials', stat.hash);
            assertEqual(4, stat.size);
        });
    });

    describe('hashSet()', ({ it }) => {
        it('hashes a canonicalizable collection', async () => {
            const store = makeStore(makeContentStore());

            assertEqual('muajbujkcmpjobtg22bjiwjrby', await store.hashSet([ 1, 2, 3 ]));
        });

        it('derives the same digest for objects with the same keys in different order', async () => {
            const store = makeStore(makeContentStore());

            const first = await store.hashSet({ a: 1, b: 2 });
            const second = await store.hashSet({ b: 2, a: 1 });

            assertEqual(first, second);
        });
    });

    describe('pathname helpers', ({ it }) => {
        it('delegates normalization and validation to the content layout rules', () => {
            const store = makeStore(makeContentStore());

            assertEqual('/a/b', store.normalizePathname('/A/B/'));
            assertEqual(true, store.isValidPathname('/a/b'));
            assertEqual(false, store.isValidPathname('/a/../b'));
        });
    });
});
