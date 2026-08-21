import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import HyperviewContentSnapshot from '../../../../src/kixx/hyperview/hyperview-content-snapshot.js';
import { PAGE_PARTIALS_BUNDLE, PAGE_INCLUDES_BUNDLE } from '../../../../src/kixx/hyperview/content-layout.js';


const encoder = new TextEncoder();

function encodeUtf8(str) {
    return encoder.encode(str);
}

function makeStat(pathname, hash, options) {
    const { kind = 'blob', size = 4, metadata = null } = options ?? {};
    return {
        pathname, kind, hash, etag: hash, size, metadata,
    };
}

// A self-contained double for the generic ContentIndexSnapshotInterface,
// mocking only the flat pathname -> stat lookups HyperviewContentSnapshot
// needs. Unlike the adapter's own tests, this deliberately does not depend on
// the Cloudflare adapter's real index/hashing machinery: HyperviewContentSnapshot
// is a consumer of the generic port, not of that adapter, so its tests mock
// the port directly.
function makeGenericSnapshot(rootHash, entries, blobs) {
    const getBlobsCalls = [];
    const computeHashFromStatsCalls = [];

    return {
        rootHash,
        getBlobsCalls,
        computeHashFromStatsCalls,
        async statPath(pathname) {
            return entries[pathname] ?? null;
        },
        async listStats(prefix, options) {
            const { recursive = true } = options ?? {};
            let normalizedPrefix = prefix;
            if (normalizedPrefix !== '' && !normalizedPrefix.endsWith('/')) {
                normalizedPrefix = `${ normalizedPrefix }/`;
            }

            return Object.keys(entries)
                .filter((pathname) => pathname !== normalizedPrefix && pathname.startsWith(normalizedPrefix))
                .filter((pathname) => {
                    if (recursive) {
                        return true;
                    }
                    return !pathname.slice(normalizedPrefix.length).includes('/');
                })
                .sort()
                .map((pathname) => entries[pathname]);
        },
        async getBlob(hash) {
            return blobs.get(hash) ?? null;
        },
        async getBlobs(hashes) {
            getBlobsCalls.push(hashes);
            return hashes.map((hash) => blobs.get(hash) ?? null);
        },
        async computeHashFromStats(stats) {
            computeHashFromStatsCalls.push(stats);
            return stats.map(({ hash }) => hash).join(':');
        },
    };
}

function makeSnapshot(rootHash, entries, blobs) {
    const snapshot = makeGenericSnapshot(rootHash, entries, blobs);
    return { snapshot, wrapper: new HyperviewContentSnapshot({ snapshot }) };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('HyperviewContentSnapshot', ({ describe }) => {

    describe('rootHash', ({ it }) => {
        it('reports the wrapped snapshot\'s pinned root hash', () => {
            const { wrapper } = makeSnapshot('root-hash-1', {}, new Map());
            assertEqual('root-hash-1', wrapper.rootHash);
        });
    });

    describe('statTemplatePartials/getTemplatePartials', ({ it }) => {
        it('resolves content by the fixed template-partials path', async () => {
            const entries = {
                '/templates/__template-partials-bundle': makeStat('/templates/__template-partials-bundle', 'partials-hash'),
            };
            const blobs = new Map([[ 'partials-hash', encodeUtf8('partials-source') ]]);
            const { wrapper } = makeSnapshot('root-hash', entries, blobs);

            const stat = await wrapper.statTemplatePartials();
            assertEqual('partials-hash', stat.hash);

            const content = await wrapper.getTemplatePartials();
            assertEqual('partials-source', content.text());
            assertEqual(stat.etag, content.etag);
        });

        it('returns null when absent', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());
            assertEqual(null, await wrapper.statTemplatePartials());
            assertEqual(null, await wrapper.getTemplatePartials());
        });
    });

    describe('statBaseTemplates/getBaseTemplates', ({ it }) => {
        it('resolves content by the fixed base-templates path', async () => {
            const entries = {
                '/templates/__base-templates-bundle': makeStat('/templates/__base-templates-bundle', 'bases-hash'),
            };
            const blobs = new Map([[ 'bases-hash', encodeUtf8('bases-source') ]]);
            const { wrapper } = makeSnapshot('root-hash', entries, blobs);

            const stat = await wrapper.statBaseTemplates();
            assertEqual('bases-hash', stat.hash);

            const content = await wrapper.getBaseTemplates();
            assertEqual('bases-source', content.text());
        });

        it('returns null when absent', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());
            assertEqual(null, await wrapper.statBaseTemplates());
            assertEqual(null, await wrapper.getBaseTemplates());
        });
    });

    describe('statPageMetadata/statPagePartials/statPageIncludes', ({ it }) => {
        it('resolves each resource under the page directory', async () => {
            const entries = {
                '/pages/blog/page.json': makeStat('/pages/blog/page.json', 'meta-hash'),
                [ `/pages/blog/${ PAGE_PARTIALS_BUNDLE }` ]: makeStat(`/pages/blog/${ PAGE_PARTIALS_BUNDLE }`, 'partials-hash'),
                [ `/pages/blog/${ PAGE_INCLUDES_BUNDLE }` ]: makeStat(`/pages/blog/${ PAGE_INCLUDES_BUNDLE }`, 'includes-hash'),
            };
            const { wrapper } = makeSnapshot('root-hash', entries, new Map());

            assertEqual('meta-hash', (await wrapper.statPageMetadata('/blog')).hash);
            assertEqual('partials-hash', (await wrapper.statPagePartials('/blog')).hash);
            assertEqual('includes-hash', (await wrapper.statPageIncludes('/blog')).hash);
        });

        it('throws an AssertionError for an invalid page pathname', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());

            const caught = await catchAsyncError(() => wrapper.statPageMetadata('/Bad Path'));
            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('statPageTemplate/getPageTemplate', ({ it }) => {
        it('returns null when an indexed pathname is absent', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());
            assertEqual(null, await wrapper.getPageTemplate('missing.html'));
        });

        it('throws an AssertionError for the root filepath "/"', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());

            const caught = await catchAsyncError(() => wrapper.getPageTemplate('/'));
            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when a pathname resolves to a directory', async () => {
            const entries = {
                '/pages/example': makeStat('/pages/example', 'dir-hash', { kind: 'tree', size: null }),
            };
            const { wrapper } = makeSnapshot('root-hash', entries, new Map());

            const caught = await catchAsyncError(() => wrapper.getPageTemplate('example'));
            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('points to a directory', caught.message);
        });

        it('throws when an indexed blob is unreadable', async () => {
            const entries = {
                '/pages/example.html': makeStat('/pages/example.html', 'missing-hash'),
            };
            const { wrapper } = makeSnapshot('root-hash', entries, new Map());

            const caught = await catchAsyncError(() => wrapper.getPageTemplate('example.html'));
            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('/pages/example.html', caught.message);
            assertMatches('missing-hash', caught.message);
        });

        it('returns content carrying the same etag the matching stat method reports', async () => {
            const entries = {
                '/pages/example.html': makeStat('/pages/example.html', 'template-hash'),
            };
            const blobs = new Map([[ 'template-hash', encodeUtf8('t') ]]);
            const { wrapper } = makeSnapshot('root-hash', entries, blobs);

            const stat = await wrapper.statPageTemplate('example.html');
            const content = await wrapper.getPageTemplate('example.html');

            assert(stat.etag, 'expected the stat object to report an etag');
            assertEqual(stat.etag, content.etag);
        });
    });

    describe('getPage', ({ it }) => {
        it('throws an AssertionError for an invalid page pathname', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());

            const caught = await catchAsyncError(() => wrapper.getPage('Bad Path'));
            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('returns null when the leaf page has no committed metadata', async () => {
            const { wrapper } = makeSnapshot('root-hash', {}, new Map());
            assertEqual(null, await wrapper.getPage('/blog/missing'));
        });

        it('returns inherited metadata, template, partials, and includes in root-to-leaf order', async () => {
            const entries = {
                '/pages/page.json': makeStat('/pages/page.json', 'root'),
                '/pages/blog/page.json': makeStat('/pages/blog/page.json', 'page'),
                '/pages/blog/index.html': makeStat('/pages/blog/index.html', 'template'),
                [ `/pages/blog/${ PAGE_PARTIALS_BUNDLE }` ]: makeStat(`/pages/blog/${ PAGE_PARTIALS_BUNDLE }`, 'partials'),
                [ `/pages/blog/${ PAGE_INCLUDES_BUNDLE }` ]: makeStat(`/pages/blog/${ PAGE_INCLUDES_BUNDLE }`, 'includes'),
            };
            const blobs = new Map([
                [ 'root', encodeUtf8('{"v":1}') ],
                [ 'page', encodeUtf8('{"v":2}') ],
                [ 'template', encodeUtf8('<html></html>') ],
                [ 'partials', encodeUtf8('[{"name":"sidebar"}]') ],
                [ 'includes', encodeUtf8('[{"name":"related"}]') ],
            ]);
            const { wrapper, snapshot } = makeSnapshot('root-hash', entries, blobs);

            const page = await wrapper.getPage('/blog');

            assertEqual(2, page.pageDataFiles.length);
            assertEqual(1, page.pageDataFiles[0].json().v);
            assertEqual(2, page.pageDataFiles[1].json().v);
            assertEqual('index.html', page.pageTemplateFilename);
            assertEqual('[{"name":"sidebar"}]', page.partials.text());
            assertEqual('[{"name":"related"}]', page.includes.text());

            // The etag is whatever the wrapped generic snapshot computed from
            // the assembled dependency list; the digest algorithm itself is
            // the generic port's responsibility and is tested there.
            assertEqual(1, snapshot.computeHashFromStatsCalls.length);
            assertEqual(page.etag, snapshot.computeHashFromStatsCalls[0].map(({ hash }) => hash).join(':'));
        });

        it('lists immediate children but not nested descendants when assembling a page', async () => {
            const entries = {
                '/pages/page.json': makeStat('/pages/page.json', 'root'),
                '/pages/blog/page.json': makeStat('/pages/blog/page.json', 'page'),
                '/pages/blog/index.html': makeStat('/pages/blog/index.html', 'template'),
                '/pages/blog/child/page.json': makeStat('/pages/blog/child/page.json', 'child'),
            };
            const blobs = new Map([
                [ 'root', encodeUtf8('{"v":1}') ],
                [ 'page', encodeUtf8('{"v":2}') ],
                [ 'template', encodeUtf8('page') ],
                [ 'child', encodeUtf8('{"v":3}') ],
            ]);
            const { wrapper, snapshot } = makeSnapshot('root-hash', entries, blobs);

            const page = await wrapper.getPage('/blog');

            assertEqual(1, snapshot.getBlobsCalls.length);
            assertEqual('root:template:page', snapshot.getBlobsCalls[0].join(':'));
            assertEqual(2, page.pageDataFiles.length);
            assertEqual('index.html', page.pageTemplateFilename);
        });

        it('throws an AssertionError when a page directory carries more than one template', async () => {
            const entries = {
                '/pages/blog/page.json': makeStat('/pages/blog/page.json', 'page'),
                '/pages/blog/one.html': makeStat('/pages/blog/one.html', 'template-one'),
                '/pages/blog/two.html': makeStat('/pages/blog/two.html', 'template-two'),
            };
            const blobs = new Map([
                [ 'page', encodeUtf8('{}') ],
                [ 'template-one', encodeUtf8('one') ],
                [ 'template-two', encodeUtf8('two') ],
            ]);
            const { wrapper } = makeSnapshot('root-hash', entries, blobs);

            const caught = await catchAsyncError(() => wrapper.getPage('/blog'));
            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('more than one page template', caught.message);
        });
    });
});
