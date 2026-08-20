import { describe } from 'kixx-test';
import { assertEqual, assertNotEqual } from 'kixx-assert';

import ContentAddressableIndex from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index.js';
import ContentSnapshot from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js';
import { stringToUint8Array, bufferToString } from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/addressing.js';


async function makeIndex(files) {
    const entries = await ContentAddressableIndex.buildIndex(files);
    return new ContentAddressableIndex(entries);
}

function makeStore(blobs) {
    const getBlobsCalls = [];

    return {
        getBlobsCalls,
        async getBlob(_context, hash) {
            return blobs.get(hash) ?? null;
        },
        async getBlobs(_context, hashes) {
            getBlobsCalls.push(hashes);
            return hashes.map((hash) => blobs.get(hash) ?? null);
        },
    };
}

function makeSnapshot(index, blobs) {
    return new ContentSnapshot({ store: makeStore(blobs), context: {}, index });
}


describe('ContentSnapshot', ({ describe, it }) => {
    it('continues to read its original index after a build reassignment', async () => {
        const v1 = await makeIndex([
            { pathname: '/templates/bundle', hash: 'v1', size: 2 },
        ]);
        const v2 = await makeIndex([
            { pathname: '/templates/bundle', hash: 'v2', size: 2 },
        ]);
        const blobs = new Map([
            [ 'v1', stringToUint8Array('v1') ],
            [ 'v2', stringToUint8Array('v2') ],
        ]);
        const snapshot = makeSnapshot(v1, blobs);

        const v1Stat = await snapshot.statPath('/templates/bundle');
        assertEqual('v1', bufferToString(await snapshot.getBlob(v1Stat.hash)));

        // This represents a subsequent request resolving the reassigned build.
        const nextSnapshot = makeSnapshot(v2, blobs);
        const v2Stat = await nextSnapshot.statPath('/templates/bundle');
        assertEqual('v2', bufferToString(await nextSnapshot.getBlob(v2Stat.hash)));

        assertEqual('v1', bufferToString(await snapshot.getBlob(v1Stat.hash)));
        assertEqual(v1.rootHash, snapshot.rootHash);
    });

    describe('computeHashFromStats', ({ it }) => {
        it('is independent of input order', async () => {
            const snapshot = makeSnapshot(await makeIndex([]), new Map());
            const statsA = [
                { pathname: '/a.txt', hash: 'hash-a', metadata: null },
                { pathname: '/b.txt', hash: 'hash-b', metadata: null },
            ];
            const statsB = [ statsA[1], statsA[0] ];

            const hashA = await snapshot.computeHashFromStats(statsA);
            const hashB = await snapshot.computeHashFromStats(statsB);

            assertEqual(hashA, hashB);
        });

        it('changes when a hash changes', async () => {
            const snapshot = makeSnapshot(await makeIndex([]), new Map());
            const statsA = [ { pathname: '/a.txt', hash: 'hash-a', metadata: null } ];
            const statsB = [ { pathname: '/a.txt', hash: 'hash-a-changed', metadata: null } ];

            const hashA = await snapshot.computeHashFromStats(statsA);
            const hashB = await snapshot.computeHashFromStats(statsB);

            assertNotEqual(hashA, hashB);
        });
    });
});
