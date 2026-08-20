import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableStore from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js';
import ContentSnapshot from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import { canonicalize, hashBlob, stringToUint8Array } from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/addressing.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

// Minimal double for the backing CloudflareContentStore, keyed by pathname.
// Only the subset of the real store's API that ContentAddressableStore calls
// is implemented; each call is recorded so tests can assert on what was sent.
function makeBackingStore(overrides) {
    const paths = new Map();
    const blobs = new Map();
    const putBlobCalls = [];
    const commitChangesCalls = [];
    const assignBuildCalls = [];
    const openSnapshotCalls = [];

    return {
        paths,
        blobs,
        putBlobCalls,
        commitChangesCalls,
        assignBuildCalls,
        openSnapshotCalls,

        async statPath(_context, pathname) {
            const entry = paths.get(pathname);
            return entry ? { pathname, ...entry } : null;
        },

        async putBlob(_context, pathname, blob, metadata, etag) {
            const hash = await hashBlob(blob);
            const entry = {
                kind: 'blob', hash, size: blob.byteLength, metadata: metadata ?? null,
            };
            paths.set(pathname, entry);
            blobs.set(hash, blob);
            putBlobCalls.push({
                pathname, blob, metadata, etag,
            });
            return { hash, pathname, size: blob.byteLength, metadata: metadata ?? null };
        },

        async getBlob(_context, hash) {
            return blobs.get(hash) ?? null;
        },

        async getBlobs(_context, hashes) {
            return hashes.map((hash) => blobs.get(hash) ?? null);
        },

        // Mirrors the real store's listStats(): lists nodes under a
        // directory prefix, honoring the recursive:false immediate-children
        // restriction that getPage() relies on.
        async listStats(_context, prefix, options) {
            const { recursive = true } = options ?? {};
            const directory = prefix.endsWith('/') ? prefix : `${ prefix }/`;
            const entries = [];

            for (const [ pathname, entry ] of paths) {
                if (!pathname.startsWith(directory)) {
                    continue;
                }
                const rest = pathname.slice(directory.length);
                if (!recursive && rest.includes('/')) {
                    continue;
                }
                entries.push({ pathname, ...entry });
            }

            return entries;
        },

        async openSnapshot(context) {
            openSnapshotCalls.push(context);
            const index = {
                rootHash: 'root-hash',
                getNode: async (pathname) => this.statPath(context, pathname),
                listNodes: async (prefix, options) => this.listStats(context, prefix, options),
            };
            return new ContentSnapshot({ store: this, context, index });
        },

        async computeHashFromStats() {
            return 'computed-etag';
        },

        async commitChanges(_context, buildId, files) {
            commitChangesCalls.push({ buildId, files });
            return { '/': [ 'tree', 'root-hash' ] };
        },

        async assignBuild(_context, buildId, rootHash) {
            assignBuildCalls.push({ buildId, rootHash });
        },

        ...overrides,
    };
}

function makeSubject(storeOverrides) {
    const store = makeBackingStore(storeOverrides);
    const subject = new ContentAddressableStore({ logger: makeLogger(), store });
    return { subject, store };
}

function makeContext() {
    return {};
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

    describe('hashValue', ({ it }) => {
        it('returns the same digest for equal values', async () => {
            const { subject } = makeSubject();

            const a = await subject.hashValue({ b: 1, a: 2 });
            const b = await subject.hashValue({ a: 2, b: 1 });

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

    describe('putTemplatePartials', ({ it }) => {
        it('uploads the canonicalized bundle to the template-partials path', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();
            const bundle = [ { name: 'header' } ];

            const result = await subject.putTemplatePartials(context, bundle, 'etag-1');

            assertEqual(1, store.putBlobCalls.length);
            const call = store.putBlobCalls[0];
            assertEqual('/templates/__template-partials-bundle', call.pathname);
            assertEqual('etag-1', call.etag);
            assertEqual(null, call.metadata);

            const expectedBlob = stringToUint8Array(canonicalize(bundle));
            assertEqual(expectedBlob.length, call.blob.length);

            assertEqual(await hashBlob(expectedBlob), result.hash);
            assertEqual(null, result.metadata);
        });
    });

    describe('putTemplatePartials', ({ it }) => {
        it('returns the stored bundle after it has been uploaded', async () => {
            const { subject } = makeSubject();
            const context = makeContext();
            const bundle = [ { name: 'header' } ];

            await subject.putTemplatePartials(context, bundle);

            const snapshot = await subject.openSnapshot(context);
            const stat = await snapshot.statTemplatePartials();
            assertEqual('blob', stat.kind);

            const content = await snapshot.getTemplatePartials();
            assertEqual(canonicalize(bundle), content.text());
        });
    });

    describe('putBaseTemplates', ({ it }) => {
        it('uploads to and reads back from the base-templates path', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();
            const bundle = { base: true };

            await subject.putBaseTemplates(context, bundle);

            assertEqual('/templates/__base-templates-bundle', store.putBlobCalls[0].pathname);

            const snapshot = await subject.openSnapshot(context);
            const stat = await snapshot.statBaseTemplates();
            assertEqual('blob', stat.kind);

            const content = await snapshot.getBaseTemplates();
            assertEqual(canonicalize(bundle), content.text());
        });
    });

    describe('putPageMetadata', ({ it }) => {
        it('throws an AssertionError for an invalid page pathname', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.putPageMetadata(context, '/Bad Path', {}),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('uploads metadata under the page directory\'s page.json path', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.putPageMetadata(context, '/blog/led-zeppelin', { title: 'Led Zeppelin' });

            assertEqual('/pages/blog/led-zeppelin/page.json', store.putBlobCalls[0].pathname);

            const stat = await (await subject.openSnapshot(context)).statPageMetadata('/blog/led-zeppelin');
            assertEqual('blob', stat.kind);
        });
    });

    describe('putPagePartials', ({ it }) => {
        it('uploads the page partial-template bundle under the page directory', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.putPagePartials(context, '/blog/led-zeppelin', [ { name: 'sidebar' } ]);

            assertEqual('/pages/blog/led-zeppelin/__page-partials-bundle', store.putBlobCalls[0].pathname);

            const stat = await (await subject.openSnapshot(context)).statPagePartials('/blog/led-zeppelin');
            assertEqual('blob', stat.kind);
        });

        it('throws an AssertionError for an invalid page pathname', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.putPagePartials(context, '/Bad Path', []),
            );

            assertEqual('AssertionError', caught.name);
        });
    });

    describe('putPageIncludes', ({ it }) => {
        it('uploads the page include bundle under the page directory', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.putPageIncludes(context, '/blog/led-zeppelin', [ { name: 'related' } ]);

            assertEqual('/pages/blog/led-zeppelin/__page-includes-bundle', store.putBlobCalls[0].pathname);

            const stat = await (await subject.openSnapshot(context)).statPageIncludes('/blog/led-zeppelin');
            assertEqual('blob', stat.kind);
        });
    });

    describe('putPageTemplate', ({ it }) => {
        it('uploads raw source text without canonicalizing it', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();
            const sourceText = '<html>{{ title }}</html>';

            await subject.putPageTemplate(context, 'blog/led-zeppelin/index.html', sourceText);

            const call = store.putBlobCalls[0];
            assertEqual('/pages/blog/led-zeppelin/index.html', call.pathname);
            assertEqual(stringToUint8Array(sourceText).length, call.blob.length);

            const snapshot = await subject.openSnapshot(context);
            const stat = await snapshot.statPageTemplate('blog/led-zeppelin/index.html');
            assertEqual('blob', stat.kind);

            const content = await snapshot.getPageTemplate('blog/led-zeppelin/index.html');
            assertEqual(sourceText, content.text());
        });

        it('throws an AssertionError for an invalid filepath', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.putPageTemplate(context, 'Bad Path', 'text'),
            );

            assertEqual('AssertionError', caught.name);
        });
    });

    describe('commitChanges', ({ describe, it }) => {
        it('throws an AssertionError when the manifest is not an object', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            const caught = await catchAsyncError(
                () => subject.commitChanges(context, 'build-1', null),
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

            const result = await subject.commitChanges(context, 'build-1', manifest);

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
                () => subject.commitChanges(context, 'build-1', manifest),
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
                () => subject.commitChanges(context, 'build-1', manifest),
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
                () => subject.commitChanges(context, 'build-1', manifest),
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
                () => subject.commitChanges(context, 'build-1', manifest),
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
                () => subject.commitChanges(context, 'build-1', manifest),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertEqual(3, caught.errors.length);
            assertMatches('reserved page filename', caught.errors[0].message);
            assertMatches('reserved page filename', caught.errors[1].message);
            assertMatches('reserved page filename', caught.errors[2].message);
        });

        describe('when a manifest group is omitted', ({ it }) => {
            it('excludes that group from the committed files', async () => {
                const { subject, store } = makeSubject();
                const context = makeContext();

                await subject.commitChanges(context, 'build-1', { baseTemplates: { hash: 'h', size: 1 } });

                const files = store.commitChangesCalls[0].files;
                assertEqual(1, files.length);
                assertEqual('/templates/__base-templates-bundle', files[0].pathname);
            });
        });
    });

    describe('assignBuild', ({ it }) => {
        it('delegates to the backing store', async () => {
            const { subject, store } = makeSubject();
            const context = makeContext();

            await subject.assignBuild(context, 'build-1', 'root-hash-1');

            assertEqual(1, store.assignBuildCalls.length);
            assertEqual('build-1', store.assignBuildCalls[0].buildId);
            assertEqual('root-hash-1', store.assignBuildCalls[0].rootHash);
        });
    });

    describe('uploaded page resources', ({ it }) => {
        it('are readable through a snapshot in root-to-leaf order', async () => {
            const { subject } = makeSubject();
            const context = makeContext();

            // Commit root and leaf page.json files, plus a page template,
            // partials, and includes bundle in the leaf directory.
            await subject.putPageMetadata(context, '/', { title: 'Root' });
            await subject.putPageMetadata(context, '/blog/led-zeppelin', { title: 'Led Zeppelin' });
            await subject.putPageTemplate(context, 'blog/led-zeppelin/index.html', '<html></html>');
            await subject.putPagePartials(context, '/blog/led-zeppelin', [ { name: 'sidebar' } ]);
            await subject.putPageIncludes(context, '/blog/led-zeppelin', [ { name: 'related' } ]);

            const page = await (await subject.openSnapshot(context)).getPage('/blog/led-zeppelin');

            assertEqual(2, page.pageDataFiles.length);
            assertEqual('Root', page.pageDataFiles[0].json().title);
            assertEqual('Led Zeppelin', page.pageDataFiles[1].json().title);
            assertEqual('index.html', page.pageTemplateFilename);
            assertEqual(canonicalize([ { name: 'sidebar' } ]), page.partials.text());
            assertEqual(canonicalize([ { name: 'related' } ]), page.includes.text());
            assertEqual('computed-etag', page.etag);
        });
    });
});
