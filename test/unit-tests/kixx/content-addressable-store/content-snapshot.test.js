import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ContentAddressableIndex from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';
import ContentSnapshot from '../../../../src/kixx/content-addressable-store/content-snapshot.js';
import {
    getBaseTemplatesPath,
    getGlobalTemplatePartialsPath,
    getPageMetadataPath,
    getPageTemplatePath,
    getStaticAssetPath,
} from '../../../../src/kixx/content-addressable-store/content-layout.js';

async function catchError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


async function makeIndex(files) {
    const entries = await ContentAddressableIndex.buildIndex(files);
    return new ContentAddressableIndex(entries);
}

// Keyed by content hash, the way the real store is: two snapshots reading
// different hashes read different bytes from one shared backing store.
function makeStore(blobsByHash, options) {
    const { putFileSize } = options ?? {};
    const getFileCalls = [];

    const getFilesCalls = [];

    const putFileCalls = [];

    return {
        getFileCalls,
        getFilesCalls,
        putFileCalls,
        async getFile(_context, type, pathname, hash) {
            getFileCalls.push({ type, pathname, hash });
            return blobsByHash.get(hash) ?? null;
        },
        // The real store contract: results come back in the same order as the
        // stats passed in, so the caller can pair each blob with its stat.
        async getFiles(_context, type, stats) {
            getFilesCalls.push({ type, stats });
            return stats.map((stat) => blobsByHash.get(stat.hash) ?? null);
        },
        async putFile(_context, pathname, hash, bytes) {
            putFileCalls.push({ pathname, hash, bytes });
            if (putFileSize !== undefined) {
                return putFileSize;
            }
            return bytes instanceof ArrayBuffer
                ? bytes.byteLength
                : new TextEncoder().encode(bytes).byteLength;
        },
    };
}

function makeStream(bytes) {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
}

async function drain(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(...chunk);
    }
    return chunks;
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
    describe('getStaticAsset()', ({ it }) => {
        it('reads the asset as a stream, without buffering the bytes', async () => {
            const assetPath = getStaticAssetPath('/logo.png');
            const bytes = new Uint8Array([ 137, 80, 78, 71 ]);
            const index = await makeIndex([
                { pathname: assetPath, hash: 'hash-logo', size: 4 },
            ]);
            const store = makeStore(new Map([ [ 'hash-logo', makeStream(bytes) ] ]));
            const snapshot = new ContentSnapshot(store, index);

            const asset = await snapshot.getStaticAsset({}, '/logo.png');

            // Static assets are the one read that streams, so their bytes can go
            // straight to the response instead of through memory first.
            assertEqual('stream', store.getFileCalls[0].type);
            assert(asset.stream instanceof ReadableStream);
            assertEqual(assetPath, asset.pathname);
            assertEqual('hash-logo', asset.hash);
            // `size` comes from the index, so a caller can still set
            // Content-Length without draining the stream to measure it.
            assertEqual(4, asset.size);

            // The stream carries the actual bytes, and carries them once.
            assertEqual('137,80,78,71', (await drain(asset.stream)).join(','));
        });

        it('returns null for an asset absent from the index', async () => {
            const index = await makeIndex([
                { pathname: getStaticAssetPath('/logo.png'), hash: 'hash-logo', size: 4 },
            ]);
            const store = makeStore(new Map());
            const snapshot = new ContentSnapshot(store, index);

            assertEqual(null, await snapshot.getStaticAsset({}, '/missing.png'));
            assertEqual(0, store.getFileCalls.length);
        });
    });

    describe('static asset listings', ({ it }) => {
        it('returns the assets tree entry when assets are published', async () => {
            const index = await makeIndex([
                { pathname: getStaticAssetPath('/logo.png'), hash: 'hash-logo', size: 4 },
            ]);
            const snapshot = makeSnapshot(index, new Map());

            const stat = snapshot.statStaticAssets();

            assert(stat, 'expected the assets tree entry');
            assertEqual('/assets', stat.pathname);
            assertEqual('tree', stat.kind);
        });

        it('returns null and an empty list when no assets are published', async () => {
            const snapshot = makeSnapshot(await makeIndex([]), new Map());

            assertEqual(null, snapshot.statStaticAssets());
            assertEqual(0, snapshot.listStaticAssets().length);
        });

        it('lists only blobs with logical asset pathnames', async () => {
            const index = await makeIndex([
                { pathname: getStaticAssetPath('/logo.png'), hash: 'hash-logo', size: 4 },
                { pathname: getStaticAssetPath('/images/banner.png'), hash: 'hash-banner', size: 7 },
            ]);
            const snapshot = makeSnapshot(index, new Map());

            const assets = snapshot.listStaticAssets();

            assertEqual(2, assets.length);
            assertEqual('/images/banner.png', assets[0].pathname);
            assertEqual('blob', assets[0].kind);
            assertEqual('/logo.png', assets[1].pathname);
            assertEqual('blob', assets[1].kind);
        });
    });

    describe('batchGetPageAssets()', ({ it }) => {
        it('collects the ancestor metadata and the leaf directory contents', async () => {
            const rootMeta = getPageMetadataPath('/');
            const blogMeta = getPageMetadataPath('/blog');
            const postMeta = getPageMetadataPath('/blog/post');
            const postTemplate = getPageTemplatePath('/blog/post/page.html');

            const index = await makeIndex([
                { pathname: rootMeta, hash: 'hash-root', size: 2 },
                { pathname: blogMeta, hash: 'hash-blog', size: 2 },
                { pathname: postMeta, hash: 'hash-post', size: 2 },
                { pathname: postTemplate, hash: 'hash-template', size: 5 },
            ]);
            const store = makeStore(new Map([
                [ 'hash-root', '{"a":1}' ],
                [ 'hash-blog', '{"b":2}' ],
                [ 'hash-post', '{"c":3}' ],
                [ 'hash-template', '<h1></h1>' ],
            ]));
            const snapshot = new ContentSnapshot(store, index);

            const result = await snapshot.batchGetPageAssets({}, '/blog/post');

            assert(result, 'expected page assets for /blog/post');
            // Ancestors first, in root-to-leaf order, so the page data cascade
            // is applied in the order the caller expects.
            assertEqual(3, result.pageDataFiles.length);
            assertEqual(rootMeta, result.pageDataFiles[0].pathname);
            assertEqual(blogMeta, result.pageDataFiles[1].pathname);
            assertEqual(postMeta, result.pageDataFiles[2].pathname);
            assertEqual('<h1></h1>', result.template.text);
            assertEqual(null, result.partials);
            assertEqual(null, result.includes);
        });

        it('skips ancestor directories which publish no page metadata', async () => {
            const rootMeta = getPageMetadataPath('/');
            const postMeta = getPageMetadataPath('/blog/post');
            const postTemplate = getPageTemplatePath('/blog/post/page.html');

            // No /pages/blog/page.json: getNode() returns null for that
            // ancestor, and the entry must be dropped rather than dereferenced.
            const index = await makeIndex([
                { pathname: rootMeta, hash: 'hash-root', size: 2 },
                { pathname: postMeta, hash: 'hash-post', size: 2 },
                { pathname: postTemplate, hash: 'hash-template', size: 5 },
            ]);
            const store = makeStore(new Map([
                [ 'hash-root', '{"a":1}' ],
                [ 'hash-post', '{"c":3}' ],
                [ 'hash-template', '<h1></h1>' ],
            ]));
            const snapshot = new ContentSnapshot(store, index);

            const result = await snapshot.batchGetPageAssets({}, '/blog/post');

            assertEqual(2, result.pageDataFiles.length);
            assertEqual(rootMeta, result.pageDataFiles[0].pathname);
            assertEqual(postMeta, result.pageDataFiles[1].pathname);
        });

        it('returns null when the leaf page has no metadata of its own', async () => {
            const index = await makeIndex([
                { pathname: getPageMetadataPath('/'), hash: 'hash-root', size: 2 },
            ]);
            const store = makeStore(new Map([ [ 'hash-root', '{"a":1}' ] ]));
            const snapshot = new ContentSnapshot(store, index);

            assertEqual(null, await snapshot.batchGetPageAssets({}, '/blog/post'));
            assertEqual(0, store.getFilesCalls.length);
        });
    });

    describe('putGlobalTemplatePartials()', ({ it }) => {
        it('returns the byte size reported by the content store', async () => {
            const index = await makeIndex([]);
            const store = makeStore(new Map(), { putFileSize: 37 });
            const snapshot = new ContentSnapshot(store, index);

            const result = await snapshot.putGlobalTemplatePartials({}, [ 'a' ]);

            assertEqual(getGlobalTemplatePartialsPath(), result.pathname);
            assertEqual(37, result.size);
            assertEqual(getGlobalTemplatePartialsPath(), store.putFileCalls[0].pathname);
        });

        it('rejects a non-Array bundle', async () => {
            const index = await makeIndex([]);
            const snapshot = new ContentSnapshot(makeStore(new Map()), index);

            const caught = await catchError(() => snapshot.putGlobalTemplatePartials({}, {}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('putBaseTemplates()', ({ it }) => {
        it('takes no pathname, matching statBaseTemplates()/getBaseTemplates()', async () => {
            const index = await makeIndex([]);
            const store = makeStore(new Map());
            const snapshot = new ContentSnapshot(store, index);

            const result = await snapshot.putBaseTemplates({}, [ 'a' ]);

            assertEqual(getBaseTemplatesPath(), result.pathname);
            assertEqual(getBaseTemplatesPath(), store.putFileCalls[0].pathname);
        });

        it('rejects a non-Array bundle', async () => {
            const index = await makeIndex([]);
            const snapshot = new ContentSnapshot(makeStore(new Map()), index);

            const caught = await catchError(() => snapshot.putBaseTemplates({}, {}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('putPageIncludes()', ({ it }) => {
        it('reports a plain-object bundle requirement when the bundle is not a plain object', async () => {
            const index = await makeIndex([]);
            const snapshot = new ContentSnapshot(makeStore(new Map()), index);

            const caught = await catchError(() => snapshot.putPageIncludes({}, '/blog/post', []));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('requires a plain object bundle'),
                `expected a plain-object message, got "${ caught.message }"`,
            );
        });
    });
});
