import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ContentAddressableIndex from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';
import ContentSnapshot from '../../../../src/kixx/content-addressable-store/content-snapshot.js';
import { getGlobalTemplatePartialsPath } from '../../../../src/kixx/content-addressable-store/content-layout.js';


async function makeIndex(files) {
    const entries = await ContentAddressableIndex.buildIndex(files);
    return new ContentAddressableIndex(entries);
}

// Keyed by content hash, the way the real store is: two snapshots reading
// different hashes read different bytes from one shared backing store.
function makeStore(blobsByHash) {
    const getFileCalls = [];

    return {
        getFileCalls,
        async getFile(_context, type, pathname, hash) {
            getFileCalls.push({ type, pathname, hash });
            return blobsByHash.get(hash) ?? null;
        },
    };
}

function makeSnapshot(index, blobsByHash) {
    return new ContentSnapshot(makeStore(blobsByHash), index);
}


describe('ContentSnapshot', ({ describe, it }) => {

    it('continues to read its original index after a build reassignment', async () => {
        const partialsPath = getGlobalTemplatePartialsPath();

        const v1 = await makeIndex([
            { pathname: partialsPath, hash: 'hash-v1', size: 12 },
        ]);
        const v2 = await makeIndex([
            { pathname: partialsPath, hash: 'hash-v2', size: 12 },
        ]);
        const blobs = new Map([
            [ 'hash-v1', '["v1"]' ],
            [ 'hash-v2', '["v2"]' ],
        ]);

        const snapshot = makeSnapshot(v1, blobs);
        const first = await snapshot.getGlobalTemplatePartials({});
        assertEqual('v1', first.json[0]);

        // A subsequent request resolving the reassigned build gets its own
        // snapshot over the new index.
        const nextSnapshot = makeSnapshot(v2, blobs);
        assertEqual('v2', (await nextSnapshot.getGlobalTemplatePartials({})).json[0]);

        // The original snapshot is unaffected by the reassignment: it holds its
        // own index, so a render already in flight cannot read half of one
        // build and half of another.
        assertEqual('v1', (await snapshot.getGlobalTemplatePartials({})).json[0]);
    });

    describe('stat accessors', ({ it }) => {
        it('returns the decoded node for content present in the index', async () => {
            const partialsPath = getGlobalTemplatePartialsPath();
            const index = await makeIndex([
                { pathname: partialsPath, hash: 'hash-v1', size: 12 },
            ]);
            const snapshot = makeSnapshot(index, new Map());

            const stat = snapshot.statGlobalTemplatePartials();

            assert(stat, 'expected a stat for the partials bundle');
            assertEqual(partialsPath, stat.pathname);
            assertEqual('blob', stat.kind);
            assertEqual('hash-v1', stat.hash);
            assertEqual(12, stat.size);
        });

        it('returns null for content absent from the index', async () => {
            const index = await makeIndex([
                { pathname: '/assets/logo.png', hash: 'hash-logo', size: 3 },
            ]);
            const snapshot = makeSnapshot(index, new Map());

            assertEqual(null, snapshot.statGlobalTemplatePartials());
        });
    });

    describe('reads', ({ it }) => {
        it('resolves the pathname to its hash before reading the blob', async () => {
            const partialsPath = getGlobalTemplatePartialsPath();
            const index = await makeIndex([
                { pathname: partialsPath, hash: 'hash-v1', size: 12 },
            ]);
            const store = makeStore(new Map([ [ 'hash-v1', '["v1"]' ] ]));
            const snapshot = new ContentSnapshot(store, index);

            await snapshot.getGlobalTemplatePartials({});

            // The store is addressed by hash, never by pathname, so the read
            // stays correct even if the same bytes are published elsewhere.
            assertEqual(1, store.getFileCalls.length);
            assertEqual('text', store.getFileCalls[0].type);
            assertEqual(partialsPath, store.getFileCalls[0].pathname);
            assertEqual('hash-v1', store.getFileCalls[0].hash);
        });

        it('returns null without reading the store when the content is absent', async () => {
            const index = await makeIndex([
                { pathname: '/assets/logo.png', hash: 'hash-logo', size: 3 },
            ]);
            const store = makeStore(new Map());
            const snapshot = new ContentSnapshot(store, index);

            assertEqual(null, await snapshot.getGlobalTemplatePartials({}));
            assertEqual(0, store.getFileCalls.length);
        });
    });
});
