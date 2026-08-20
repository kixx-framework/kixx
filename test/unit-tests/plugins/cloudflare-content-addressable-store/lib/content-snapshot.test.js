import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableIndex from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index.js';
import ContentSnapshot from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js';
import { stringToUint8Array } from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/addressing.js';


async function makeIndex(files) {
    const entries = await ContentAddressableIndex.buildIndex(files);
    return new ContentAddressableIndex(entries);
}

function makeStore(blobs) {
    return {
        async getBlob(_context, hash) {
            return blobs.get(hash) ?? null;
        },
        async getBlobs(_context, hashes) {
            return hashes.map((hash) => blobs.get(hash) ?? null);
        },
        async computeHashFromStats(stats) {
            return stats.map(({ hash }) => hash).join(':');
        },
    };
}

function makeSnapshot(index, blobs) {
    return new ContentSnapshot({ store: makeStore(blobs), context: {}, index });
}

function makeDeferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('ContentSnapshot', ({ it }) => {
    it('continues to read its original index after a build reassignment', async () => {
        const v1 = await makeIndex([
            { pathname: '/templates/__template-partials-bundle', hash: 'v1', size: 2 },
        ]);
        const v2 = await makeIndex([
            { pathname: '/templates/__template-partials-bundle', hash: 'v2', size: 2 },
        ]);
        const blobs = new Map([
            [ 'v1', stringToUint8Array('v1') ],
            [ 'v2', stringToUint8Array('v2') ],
        ]);
        const snapshot = makeSnapshot(v1, blobs);

        assertEqual('v1', (await snapshot.getTemplatePartials()).text());

        // This represents a subsequent request resolving the reassigned build.
        const nextSnapshot = makeSnapshot(v2, blobs);
        assertEqual('v2', (await nextSnapshot.getTemplatePartials()).text());
        assertEqual('v1', (await snapshot.getTemplatePartials()).text());
        assertEqual(v1.rootHash, snapshot.rootHash);
    });

    it('uses one pinned index for every getPage lookup and blob read', async () => {
        const v1 = await makeIndex([
            { pathname: '/pages/page.json', hash: 'root-v1', size: 4 },
            { pathname: '/pages/blog/page.json', hash: 'page-v1', size: 4 },
            { pathname: '/pages/blog/index.html', hash: 'template-v1', size: 4 },
        ]);
        const v2 = await makeIndex([
            { pathname: '/pages/page.json', hash: 'root-v2', size: 4 },
            { pathname: '/pages/blog/page.json', hash: 'page-v2', size: 4 },
            { pathname: '/pages/blog/index.html', hash: 'template-v2', size: 4 },
        ]);
        const blobs = new Map([
            [ 'root-v1', stringToUint8Array('{"v":1}') ],
            [ 'page-v1', stringToUint8Array('{"v":1}') ],
            [ 'template-v1', stringToUint8Array('v1') ],
            [ 'root-v2', stringToUint8Array('{"v":2}') ],
            [ 'page-v2', stringToUint8Array('{"v":2}') ],
            [ 'template-v2', stringToUint8Array('v2') ],
        ]);
        const snapshot = makeSnapshot(v1, blobs);

        // A newly opened snapshot can observe V2 without changing this one.
        const v2Page = await makeSnapshot(v2, blobs).getPage('/blog');
        assertEqual(2, v2Page.pageDataFiles[0].json().v);

        const page = await snapshot.getPage('/blog');
        assertEqual(2, page.pageDataFiles.length);
        assertEqual(1, page.pageDataFiles[0].json().v);
        assertEqual(1, page.pageDataFiles[1].json().v);
        assertEqual('index.html', page.pageTemplateFilename);
        assertEqual('root-v1:root-v1:template-v1:page-v1', page.etag);
    });

    it('keeps getPage on V1 when reassignment occurs after its first lookup', async () => {
        const v1 = await makeIndex([
            { pathname: '/pages/page.json', hash: 'root-v1', size: 7 },
            { pathname: '/pages/blog/page.json', hash: 'page-v1', size: 7 },
            { pathname: '/pages/blog/index.html', hash: 'template-v1', size: 2 },
        ]);
        const v2 = await makeIndex([
            { pathname: '/pages/page.json', hash: 'root-v2', size: 7 },
            { pathname: '/pages/blog/page.json', hash: 'page-v2', size: 7 },
            { pathname: '/pages/blog/index.html', hash: 'template-v2', size: 2 },
        ]);
        const firstLookup = makeDeferred();
        const resume = makeDeferred();
        let index = v1;
        let hasPaused = false;
        const pinnedIndex = {
            get rootHash() {
                return v1.rootHash;
            },
            async getNode(pathname) {
                if (!hasPaused) {
                    hasPaused = true;
                    firstLookup.resolve();
                    await resume.promise;
                }
                return await v1.getNode(pathname);
            },
            async listNodes(prefix, options) {
                return await v1.listNodes(prefix, options);
            },
        };
        const blobs = new Map([
            [ 'root-v1', stringToUint8Array('{"v":1}') ],
            [ 'page-v1', stringToUint8Array('{"v":1}') ],
            [ 'template-v1', stringToUint8Array('v1') ],
            [ 'root-v2', stringToUint8Array('{"v":2}') ],
            [ 'page-v2', stringToUint8Array('{"v":2}') ],
            [ 'template-v2', stringToUint8Array('v2') ],
        ]);
        const snapshot = makeSnapshot(pinnedIndex, blobs);

        const pagePromise = snapshot.getPage('/blog');
        await firstLookup.promise;
        index = v2;
        resume.resolve();

        const page = await pagePromise;

        assertEqual(v2.rootHash, index.rootHash);
        assertEqual(1, page.pageDataFiles[0].json().v);
        assertEqual(1, page.pageDataFiles[1].json().v);
        assertEqual('index.html', page.pageTemplateFilename);
        assertEqual('root-v1:root-v1:template-v1:page-v1', page.etag);
    });

    it('throws an AssertionError for an invalid page pathname', async () => {
        const snapshot = makeSnapshot(await makeIndex([]), new Map());

        const caught = await catchAsyncError(() => snapshot.getPage('Bad Path'));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
    });

    it('returns null from getPage when the leaf page has no committed metadata', async () => {
        const snapshot = makeSnapshot(await makeIndex([]), new Map());

        assertEqual(null, await snapshot.getPage('/blog/missing'));
    });

    it('returns null when an indexed pathname is absent', async () => {
        const snapshot = makeSnapshot(await makeIndex([]), new Map());

        assertEqual(null, await snapshot.getPageTemplate('missing.html'));
    });

    it('throws when a pathname resolves to a directory', async () => {
        const snapshot = makeSnapshot(await makeIndex([
            { pathname: '/pages/example/file.html', hash: 'content', size: 1 },
        ]), new Map([ [ 'content', stringToUint8Array('x') ] ]));

        const caught = await catchAsyncError(() => snapshot.getPageTemplate('example'));
        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('points to a directory', caught.message);
    });

    it('throws when an indexed blob is unreadable', async () => {
        const snapshot = makeSnapshot(await makeIndex([
            { pathname: '/pages/example.html', hash: 'missing-hash', size: 1 },
        ]), new Map());

        const caught = await catchAsyncError(() => snapshot.getPageTemplate('example.html'));
        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('/pages/example.html', caught.message);
        assertMatches('missing-hash', caught.message);
    });

    it('returns content carrying the same etag the matching stat method reports', async () => {
        const index = await makeIndex([
            { pathname: '/templates/__template-partials-bundle', hash: 'partials', size: 2 },
            { pathname: '/templates/__base-templates-bundle', hash: 'bases', size: 2 },
            { pathname: '/pages/example.html', hash: 'template', size: 2 },
        ]);
        const snapshot = makeSnapshot(index, new Map([
            [ 'partials', stringToUint8Array('p') ],
            [ 'bases', stringToUint8Array('b') ],
            [ 'template', stringToUint8Array('t') ],
        ]));

        // Callers cache compiled templates under the content etag and validate
        // them against the stat etag, so the two must be the same value.
        const pairs = [
            [ await snapshot.statTemplatePartials(), await snapshot.getTemplatePartials() ],
            [ await snapshot.statBaseTemplates(), await snapshot.getBaseTemplates() ],
            [ await snapshot.statPageTemplate('example.html'), await snapshot.getPageTemplate('example.html') ],
        ];

        for (const [ stat, content ] of pairs) {
            assert(stat.etag, 'expected the stat object to report an etag');
            assertEqual(stat.etag, content.etag);
        }
    });
});
