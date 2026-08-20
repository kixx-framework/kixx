import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import HyperviewContentService from '../../../../src/kixx/hyperview/hyperview-content-service.js';
import { canonicalize } from '../../../../src/kixx/utils/canonicalize.js';


const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeUtf8(str) {
    return encoder.encode(str);
}

// Deterministic, content-derived fake hash. Real digest computation belongs
// to the generic content-addressable store adapter and is tested there; this
// double only needs a stable, distinguishable identity per distinct payload.
async function fakeHashBlob(bytes) {
    return `hash:${ decoder.decode(bytes) }`;
}

function makeGenericSnapshotFromPaths(paths, blobs) {
    return {
        rootHash: 'root-hash',
        async statPath(pathname) {
            return paths.get(pathname) ?? null;
        },
        async listStats(prefix, options) {
            const { recursive = true } = options ?? {};
            const normalizedPrefix = prefix.endsWith('/') ? prefix : `${ prefix }/`;
            const results = [];

            for (const [ pathname, entry ] of paths) {
                if (!pathname.startsWith(normalizedPrefix)) {
                    continue;
                }
                const rest = pathname.slice(normalizedPrefix.length);
                if (!recursive && rest.includes('/')) {
                    continue;
                }
                results.push(entry);
            }

            return results.sort((a, b) => {
                if (a.pathname < b.pathname) {
                    return -1;
                }
                if (a.pathname > b.pathname) {
                    return 1;
                }
                return 0;
            });
        },
        async getBlob(hash) {
            return blobs.get(hash) ?? null;
        },
        async getBlobs(hashes) {
            return hashes.map((hash) => blobs.get(hash) ?? null);
        },
        async computeHashFromStats() {
            return 'page-etag';
        },
    };
}

// Minimal double for the generic ContentAddressableStoreInterface.
// HyperviewContentService is a consumer of that port, not of any concrete
// adapter, so its tests mock the port directly rather than depending on the
// Cloudflare adapter's real hashing and index machinery.
function makeBackingStore(overrides) {
    const paths = new Map();
    const blobs = new Map();
    const putBlobCalls = [];
    const commitChangesCalls = [];
    const openSnapshotCalls = [];

    return {
        paths,
        blobs,
        putBlobCalls,
        commitChangesCalls,
        openSnapshotCalls,

        async hashValue(value) {
            return `value-hash:${ canonicalize(value) }`;
        },

        async putBlob(_context, pathname, blob, metadata, etag) {
            const hash = await fakeHashBlob(blob);
            const entry = {
                pathname, kind: 'blob', hash, etag: hash, size: blob.byteLength, metadata: metadata ?? null,
            };
            paths.set(pathname, entry);
            blobs.set(hash, blob);
            putBlobCalls.push({
                pathname, blob, metadata, etag,
            });
            return {
                hash, pathname, size: blob.byteLength, metadata: metadata ?? null,
            };
        },

        async openSnapshot(context) {
            openSnapshotCalls.push(context);
            return makeGenericSnapshotFromPaths(paths, blobs);
        },

        async commitChanges(_context, buildId, files) {
            commitChangesCalls.push({ buildId, files });
            return { rootHash: 'root-hash', nodeCount: 1 };
        },

        ...overrides,
    };
}

function makeSubject(storeOverrides) {
    const store = makeBackingStore(storeOverrides);
    const subject = new HyperviewContentService();
    subject.initialize({ contentStore: store });
    return { subject, store };
}

function makeContext(overrides) {
    return {
        runtime: { build: { id: 'runtime-build-id' } },
        ...overrides,
    };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('HyperviewContentService', ({ describe }) => {

    describe('initialize', ({ it }) => {
        it('throws an AssertionError naming the service and the missing dependency', () => {
            const subject = new HyperviewContentService();

            const caught = catchError(() => subject.initialize({}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('HyperviewContentService', caught.message);
            assertMatches('contentStore', caught.message);
        });

        it('throws when called with no arguments at all', () => {
            const subject = new HyperviewContentService();

            const caught = catchError(() => subject.initialize());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('hashValue', ({ it }) => {
        it('delegates to the backing store', async () => {
            const { subject, store } = makeSubject();

            const a = await subject.hashValue({ b: 1, a: 2 });
            const b = await store.hashValue({ a: 2, b: 1 });

            assertEqual(a, b);
        });
    });

    describe('isValidPathname', ({ it }) => {
        it('returns true for a lowercase, safe pathname', () => {
            const { subject } = makeSubject();
            assert(subject.isValidPathname('/blog/reviews'));
        });

        it('returns false for a pathname containing ".."', () => {
            const { subject } = makeSubject();
            assertEqual(false, subject.isValidPathname('/blog/../secrets'));
        });
    });

    describe('isValidTemplateFilepath', ({ it }) => {
        it('returns true for a non-root filepath', () => {
            const { subject } = makeSubject();
            assert(subject.isValidTemplateFilepath('blog/index.html'));
        });

        it('returns false for the root pathname "/"', () => {
            const { subject } = makeSubject();
            assertEqual(false, subject.isValidTemplateFilepath('/'));
        });
    });

    describe('normalizePathname', ({ it }) => {
        it('removes empty segments and folds to lowercase', () => {
            const { subject } = makeSubject();
            assertEqual('/blog/reviews', subject.normalizePathname('//Blog//Reviews//'));
        });
    });

    describe('openSnapshot', ({ it }) => {
        it('delegates exactly once to the backing store for each snapshot', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            const snapshot = await subject.openSnapshot(context);

            assertEqual(1, store.openSnapshotCalls.length);
            assertEqual('root-hash', snapshot.rootHash);
        });
    });

    describe('one-off stat reads', ({ it }) => {
        it('each open exactly one snapshot and return null for absent resources', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            assertEqual(null, await subject.statTemplatePartials(context));
            assertEqual(null, await subject.statBaseTemplates(context));
            assertEqual(null, await subject.statPageMetadata(context, '/blog'));
            assertEqual(null, await subject.statPagePartials(context, '/blog'));
            assertEqual(null, await subject.statPageIncludes(context, '/blog'));
            assertEqual(null, await subject.statPageTemplate(context, 'blog/index.html'));

            assertEqual(6, store.openSnapshotCalls.length);
        });

        it('resolve a stat after the matching resource is uploaded', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            await subject.putTemplatePartials(context, { bundle: [] });
            const stat = await subject.statTemplatePartials(context);

            assertEqual('blob', stat.kind);
        });
    });

    describe('putTemplatePartials', ({ it }) => {
        it('uploads the canonicalized bundle to the template-partials path', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();
            const bundle = [ { name: 'header' } ];

            const result = await subject.putTemplatePartials(context, { bundle, etag: 'etag-1' });

            assertEqual(1, store.putBlobCalls.length);
            const call = store.putBlobCalls[0];
            assertEqual('/templates/__template-partials-bundle', call.pathname);
            assertEqual('etag-1', call.etag);
            assertEqual(null, call.metadata);

            const expectedBlob = encodeUtf8(canonicalize(bundle));
            assertEqual(expectedBlob.length, call.blob.length);
            assertEqual(null, result.metadata);
        });

        it('returns content readable through a snapshot after upload', async () => {
            const { subject } = makeSubject();
            const context = makeContext();
            const bundle = [ { name: 'header' } ];

            await subject.putTemplatePartials(context, { bundle });

            const snapshot = await subject.openSnapshot(context);
            const content = await snapshot.getTemplatePartials();
            assertEqual(canonicalize(bundle), content.text());
        });
    });

    describe('putBaseTemplates', ({ it }) => {
        it('uploads to and reads back from the base-templates path', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();
            const bundle = { base: true };

            await subject.putBaseTemplates(context, { bundle });

            assertEqual('/templates/__base-templates-bundle', store.putBlobCalls[0].pathname);

            const snapshot = await subject.openSnapshot(context);
            const content = await snapshot.getBaseTemplates();
            assertEqual(canonicalize(bundle), content.text());
        });
    });

    describe('putPageMetadata', ({ it }) => {
        it('throws an AssertionError for an invalid page pathname', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.putPageMetadata(context, { pathname: '/Bad Path', metadata: {} }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('uploads metadata under the page directory\'s page.json path', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.putPageMetadata(context, {
                pathname: '/blog/led-zeppelin',
                metadata: { title: 'Led Zeppelin' },
            });

            assertEqual('/pages/blog/led-zeppelin/page.json', store.putBlobCalls[0].pathname);
        });
    });

    describe('putPagePartials', ({ it }) => {
        it('uploads the page partial-template bundle under the page directory', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.putPagePartials(context, { pathname: '/blog/led-zeppelin', bundle: [ { name: 'sidebar' } ] });

            assertEqual('/pages/blog/led-zeppelin/__page-partials-bundle', store.putBlobCalls[0].pathname);
        });

        it('throws an AssertionError for an invalid page pathname', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.putPagePartials(context, { pathname: '/Bad Path', bundle: [] }),
            );

            assertEqual('AssertionError', caught.name);
        });
    });

    describe('putPageIncludes', ({ it }) => {
        it('uploads the page include bundle under the page directory', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.putPageIncludes(context, { pathname: '/blog/led-zeppelin', bundle: [ { name: 'related' } ] });

            assertEqual('/pages/blog/led-zeppelin/__page-includes-bundle', store.putBlobCalls[0].pathname);
        });
    });

    describe('putPageTemplate', ({ it }) => {
        it('uploads raw source text without canonicalizing it', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();
            const sourceText = '<html>{{ title }}</html>';

            await subject.putPageTemplate(context, { filepath: 'blog/led-zeppelin/index.html', source: sourceText });

            const call = store.putBlobCalls[0];
            assertEqual('/pages/blog/led-zeppelin/index.html', call.pathname);
            assertEqual(encodeUtf8(sourceText).length, call.blob.length);

            const snapshot = await subject.openSnapshot(context);
            const content = await snapshot.getPageTemplate('blog/led-zeppelin/index.html');
            assertEqual(sourceText, content.text());
        });

        it('throws an AssertionError for the root filepath "/"', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.putPageTemplate(context, { filepath: '/', source: 'text' }),
            );

            assertEqual('AssertionError', caught.name);
        });
    });

    describe('commitChanges', ({ describe, it }) => {
        it('throws an AssertionError when the manifest is not an object', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest: null }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('commits the manifest and returns the root hash and node count', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            const manifest = {
                templatePartials: { hash: 'hash-tp', size: 10 },
                baseTemplates: { hash: 'hash-bt', size: 20 },
                pageMetadata: [
                    { pathname: '/blog', hash: 'hash-meta', size: 5 },
                ],
                pageTemplates: [
                    { filename: 'blog/index.html', hash: 'hash-tpl', size: 30 },
                ],
            };

            const result = await subject.commitChanges(context, { buildId: 'build-1', manifest });

            assertEqual('root-hash', result.hash);
            assertEqual(1, result.count);
            assertEqual('build-1', store.commitChangesCalls[0].buildId);

            const files = store.commitChangesCalls[0].files;
            const pathnames = files.map((file) => file.pathname).sort();
            assertEqual(
                '/pages/blog/index.html,/pages/blog/page.json,/templates/__base-templates-bundle,/templates/__template-partials-bundle',
                pathnames.join(','),
            );
        });

        it('defaults an omitted build ID to context.runtime.build.id', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext({ runtime: { build: { id: 'the-runtime-build' } } });

            await subject.commitChanges(context, { manifest: { baseTemplates: { hash: 'h', size: 1 } } });

            assertEqual('the-runtime-build', store.commitChangesCalls[0].buildId);
        });

        it('preserves an explicit build ID rather than defaulting it', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext({ runtime: { build: { id: 'the-runtime-build' } } });

            await subject.commitChanges(context, {
                buildId: 'explicit-build',
                manifest: { baseTemplates: { hash: 'h', size: 1 } },
            });

            assertEqual('explicit-build', store.commitChangesCalls[0].buildId);
        });

        it('passes an explicit null build ID through unchanged rather than defaulting it', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext({ runtime: { build: { id: 'the-runtime-build' } } });

            await subject.commitChanges(context, {
                buildId: null,
                manifest: { baseTemplates: { hash: 'h', size: 1 } },
            });

            assertEqual(null, store.commitChangesCalls[0].buildId);
        });

        it('throws a ValidationError collecting every malformed entry', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                templatePartials: { hash: '', size: -1 },
                pageMetadata: [
                    { pathname: 'Not Valid', hash: 'h', size: 1 },
                    'not-an-object',
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertEqual('VALIDATION_ERROR', caught.code);
            assert(caught.errors.length >= 4, 'expected every malformed entry to be reported');
        });

        it('throws a ValidationError when two manifest entries map to the same pathname', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageMetadata: [
                    { pathname: '/blog', hash: 'hash-a', size: 1 },
                    { pathname: '/blog', hash: 'hash-b', size: 2 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('duplicates pathname', caught.errors[0].message);
        });

        it('throws a ValidationError when two page templates are assigned to the same page', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageTemplates: [
                    { filename: 'blog/index.html', hash: 'hash-a', size: 1 },
                    { filename: 'blog/index2.html', hash: 'hash-b', size: 2 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('duplicates the page template already assigned', caught.errors[0].message);
        });

        it('throws a ValidationError when leading slashes disguise duplicate page templates', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageTemplates: [
                    { filename: 'about/index.html', hash: 'hash-a', size: 1 },
                    { filename: '/about/other.html', hash: 'hash-b', size: 2 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('duplicates the page template already assigned', caught.errors[0].message);
        });

        it('throws a ValidationError when a page template uses a reserved page filename', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageTemplates: [
                    { filename: 'about/page.json', hash: 'hash-a', size: 1 },
                    { filename: 'contact/__page-partials-bundle', hash: 'hash-b', size: 2 },
                    { filename: 'legal/__page-includes-bundle', hash: 'hash-c', size: 3 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertEqual(3, caught.errors.length);
            assertMatches('reserved page filename', caught.errors[0].message);
            assertMatches('reserved page filename', caught.errors[1].message);
            assertMatches('reserved page filename', caught.errors[2].message);
        });

        it('throws a ValidationError when a page template collides with a sibling page directory', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            // The child page forces "/pages/about/team" to be a directory,
            // while the page template claims the same pathname as a file.
            const manifest = {
                pageMetadata: [
                    { pathname: 'about', hash: 'hash-a', size: 1 },
                    { pathname: 'about/team', hash: 'hash-b', size: 2 },
                ],
                pageTemplates: [
                    { filename: 'about/team', hash: 'hash-c', size: 3 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('already used as a page directory', caught.errors[0].message);
        });

        it('throws a ValidationError when a manifest entry nests beneath another entry\'s file', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageMetadata: [
                    { pathname: 'about', hash: 'hash-a', size: 1 },
                ],
                pageTemplates: [
                    { filename: 'about/page.json/index.html', hash: 'hash-b', size: 2 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('nests under file', caught.errors[0].message);
        });

        it('throws a ValidationError when a page directory uses a reserved page filename', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageMetadata: [
                    { pathname: 'about/__page-partials-bundle', hash: 'hash-a', size: 1 },
                ],
                pageIncludes: [
                    { pathname: 'contact/page.json', hash: 'hash-b', size: 2 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertEqual(2, caught.errors.length);
            assertMatches('reserved page filename', caught.errors[0].message);
            assertMatches('reserved page filename', caught.errors[1].message);
        });

        it('accepts a page directory that shares a prefix with a sibling page', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageMetadata: [
                    { pathname: 'about', hash: 'hash-a', size: 1 },
                    { pathname: 'about-us', hash: 'hash-b', size: 2 },
                    { pathname: 'about/team', hash: 'hash-c', size: 3 },
                ],
                pageTemplates: [
                    { filename: 'about/index.html', hash: 'hash-d', size: 4 },
                ],
            };

            await subject.commitChanges(context, { buildId: 'build-1', manifest });

            const files = store.commitChangesCalls[0].files;
            assertEqual(4, files.length);
        });

        it('rejects a pageTemplates entry whose filename is the root pathname "/"', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const manifest = {
                pageTemplates: [
                    { filename: '/', hash: 'hash-a', size: 1 },
                ],
            };

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, { buildId: 'build-1', manifest }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('pageTemplates[0].filename', caught.errors[0].message);
            assertMatches('template filepath', caught.errors[0].message);
        });

        describe('when a manifest group is omitted', ({ it }) => {
            it('excludes that group from the committed files', async () => {
                const { subject, store } = makeSubject();
                const context = makeContext();

                await subject.commitChanges(context, { buildId: 'build-1', manifest: { baseTemplates: { hash: 'h', size: 1 } } });

                const files = store.commitChangesCalls[0].files;
                assertEqual(1, files.length);
                assertEqual('/templates/__base-templates-bundle', files[0].pathname);
            });
        });
    });

    describe('uploaded page resources', ({ it }) => {
        it('are readable through a snapshot in root-to-leaf order', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            await subject.putPageMetadata(context, { pathname: '/', metadata: { title: 'Root' } });
            await subject.putPageMetadata(context, { pathname: '/blog/led-zeppelin', metadata: { title: 'Led Zeppelin' } });
            await subject.putPageTemplate(context, { filepath: 'blog/led-zeppelin/index.html', source: '<html></html>' });
            await subject.putPagePartials(context, { pathname: '/blog/led-zeppelin', bundle: [ { name: 'sidebar' } ] });
            await subject.putPageIncludes(context, { pathname: '/blog/led-zeppelin', bundle: [ { name: 'related' } ] });

            const page = await (await subject.openSnapshot(context)).getPage('/blog/led-zeppelin');

            assertEqual(2, page.pageDataFiles.length);
            assertEqual('Root', page.pageDataFiles[0].json().title);
            assertEqual('Led Zeppelin', page.pageDataFiles[1].json().title);
            assertEqual('index.html', page.pageTemplateFilename);
            assertEqual(canonicalize([ { name: 'sidebar' } ]), page.partials.text());
            assertEqual(canonicalize([ { name: 'related' } ]), page.includes.text());
            assert(page.etag, 'expected getPage to compute an etag');
        });
    });
});
