import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from 'kixx-assert';

import HyperviewService from '../../../../src/kixx/hyperview/hyperview-service.js';
import { NO_BUILD_ID_SEGMENT } from '../../../../src/kixx/utils/build-id.js';


function makeContext(buildId = 'build-1') {
    return {
        runtime: {
            build: { id: buildId },
        },
    };
}

function makeContextWithoutBuild() {
    return { runtime: {} };
}

function makeLogger() {
    return {
        createChild() {
            return {
                debug() {},
            };
        },
    };
}

function makeStores() {
    return {
        kvStore: {
            async get() {
                return null;
            },
            async put() {},
        },
        pageDataStore: {
            async getJSONFiles() {
                return [];
            },
            async getTextFiles() {
                return [];
            },
            async putJSONFile() {},
            async putTextFile() {},
        },
        templateFileStore: {
            async getBaseTemplate() {
                return null;
            },
            async getPageTemplate() {
                return null;
            },
            async getPartials() {
                return [];
            },
            async putBaseTemplate() {},
            async putPageTemplate() {},
            async putPartial() {},
        },
    };
}

function makeService(stores = makeStores()) {
    const service = new HyperviewService({ logger: makeLogger() });
    service.initialize(stores);
    return service;
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

async function assertIdentifierRejected(fn, message) {
    const caught = await catchAsyncError(fn);

    assert(caught, 'expected an error to be thrown');
    assertEqual('AssertionError', caught.name);
    assertMatches(message, caught.message);
}

function assertJSONEqual(expected, actual) {
    assertEqual(JSON.stringify(expected), JSON.stringify(actual));
}


describe('HyperviewService', ({ describe }) => {
    describe('construction and initialization', ({ it }) => {
        it('requires a logger', () => {
            const caught = catchError(() => new HyperviewService());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('HyperviewService requires a logger', caught.message);
        });

        it('requires all stores during initialization', () => {
            const service = new HyperviewService({ logger: makeLogger() });
            const caught = catchError(() => service.initialize());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('HyperviewService requires a kvStore', caught.message);
        });
    });

    describe('getPageMetadata', ({ it }) => {
        it('merges ancestor metadata while retaining includes from only the leaf page', async () => {
            const stores = makeStores();
            let received;
            stores.pageDataStore.getJSONFiles = async (context, buildId, filepaths) => {
                received = { context, buildId, filepaths };
                return [
                    { json: { version: 'root', page: { title: 'Root' }, includes: { root: { filename: 'root.md' } } } },
                    null,
                    { json: { version: 'leaf', page: { description: 'Leaf' }, includes: { body: { filename: 'body.md' } } } },
                ];
            };
            const service = makeService(stores);
            const context = makeContext('build-2');

            const result = await service.getPageMetadata(context, '/blog/post');

            assertEqual(context, received.context);
            assertEqual('build-2', received.buildId);
            assertJSONEqual([ '/page.json', '/blog/page.json', '/blog/post/page.json' ], received.filepaths);
            assertEqual('root:leaf', result.version);
            assertEqual('build-2', result.metadata.build_id);
            assertEqual('leaf', result.metadata.version);
            assertEqual('Root', result.metadata.page.title);
            assertEqual('Leaf', result.metadata.page.description);
            assertEqual('body.md', result.metadata.includes.body.filename);
        });

        it('returns null when the leaf metadata is absent', async () => {
            const stores = makeStores();
            stores.pageDataStore.getJSONFiles = async () => [ { json: { version: 'root' } }, null ];
            const service = makeService(stores);

            const result = await service.getPageMetadata(makeContext(), '/missing');

            assertEqual(null, result);
        });

        it('uses the no-build placeholder in metadata when the runtime Build ID is null', async () => {
            const stores = makeStores();
            stores.pageDataStore.getJSONFiles = async () => [ { json: { version: 'root' } } ];
            const service = makeService(stores);

            const result = await service.getPageMetadata(makeContext(null), '/');

            assertEqual(NO_BUILD_ID_SEGMENT, result.metadata.build_id);
        });

        it('uses the no-build placeholder in metadata when the runtime has no build', async () => {
            const stores = makeStores();
            stores.pageDataStore.getJSONFiles = async () => [ { json: { version: 'root' } } ];
            const service = makeService(stores);

            const result = await service.getPageMetadata(makeContextWithoutBuild(), '/');

            assertEqual(NO_BUILD_ID_SEGMENT, result.metadata.build_id);
        });

        it('rejects a non-canonical pathname before reading the store', async () => {
            const stores = makeStores();
            let reads = 0;
            stores.pageDataStore.getJSONFiles = async () => {
                reads += 1;
                return [];
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.getPageMetadata(makeContext(), '/Blog'),
                'HyperviewService.getPageMetadata: pathname',
            );
            assertEqual(0, reads);
        });
    });

    describe('page caching', ({ it }) => {
        it('uses the build, pathname, and content version in cache keys', async () => {
            const stores = makeStores();
            const calls = [];
            stores.kvStore.get = async (...args) => {
                calls.push([ 'get', ...args ]);
                return '<p>cached</p>';
            };
            stores.kvStore.put = async (...args) => {
                calls.push([ 'put', ...args ]);
            };
            const service = makeService(stores);
            const context = makeContext('build-3');

            assertEqual('<p>cached</p>', await service.getCachedPage(context, '/blog', 'v4'));
            await service.setCachedPage(context, '/blog', 'v4', '<p>new</p>');

            assertJSONEqual([
                [ 'get', context, 'hyperview_page_cache:build-3:/blog:v4', { type: 'text' } ],
                [ 'put', context, 'hyperview_page_cache:build-3:/blog:v4', '<p>new</p>', { type: 'text' } ],
            ], calls);
        });

        it('rejects non-canonical pathnames before building cache entries', async () => {
            const stores = makeStores();
            let reads = 0;
            let writes = 0;
            stores.kvStore.get = async () => {
                reads += 1;
                return null;
            };
            stores.kvStore.put = async () => {
                writes += 1;
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.getCachedPage(makeContext(), '/Blog', 'v1'),
                'HyperviewService.getCachedPage: pathname',
            );
            await assertIdentifierRejected(
                () => service.setCachedPage(makeContext(), '/Blog', 'v1', '<p/>'),
                'HyperviewService.setCachedPage: pathname',
            );

            assertEqual(0, reads);
            assertEqual(0, writes);
        });
    });

    describe('mergePageMetadata', ({ it }) => {
        it('attaches missing page metadata and supplies canonical and Open Graph defaults', () => {
            const service = makeService();
            const metadata = {
                site: { name: 'Kixx' },
                page: undefined,
            };

            const page = service.mergePageMetadata(
                new URL('https://example.test/Blog?ref=feed#top'),
                metadata,
            );

            assertEqual(page, metadata.page);
            assertJSONEqual({
                pathname: '/blog',
                canonical_url: 'https://example.test/blog',
                href: 'https://example.test/Blog?ref=feed#top',
                open_graph: {
                    url: 'https://example.test/blog',
                    type: 'website',
                },
            }, page);
            assertUndefined(page.open_graph.title);
            assertUndefined(page.open_graph.description);
            assertUndefined(page.open_graph.locale);
        });

        it('renders templated title and description without overwriting Open Graph values', () => {
            const service = makeService();
            const metadata = {
                site: { name: 'Kixx' },
                page: {
                    title: { template: '{{ site.name }} notes' },
                    description: { template: 'Read {{ site.name }}' },
                    locale: 'en-US',
                    open_graph: { title: 'Custom title' },
                },
            };

            const page = service.mergePageMetadata(new URL('https://example.test/notes'), metadata);

            assertEqual('Kixx notes', page.title);
            assertEqual('Read Kixx', page.description);
            assertEqual('Custom title', page.open_graph.title);
            assertEqual('Read Kixx', page.open_graph.description);
            assertEqual('en-US', page.open_graph.locale);
        });
    });

    describe('getIncludes', ({ it }) => {
        it('renders templated includes with current metadata while caching their compiled form', async () => {
            const stores = makeStores();
            let reads = 0;
            let receivedFilepaths;
            stores.pageDataStore.getTextFiles = async (_context, _buildId, filepaths) => {
                reads += 1;
                receivedFilepaths = filepaths;
                return [
                    { filepath: 'blog/summary.html', source: 'Hello {{ person }}' },
                    { filepath: 'blog/body.md', source: 'Static body' },
                ];
            };
            const service = makeService(stores);
            const includes = {
                summary: { filename: 'summary.html', template: true },
                body: { filename: 'body.md' },
            };

            const first = await service.getIncludes(makeContext(), '/blog', includes, {
                useCache: true,
                version: 'v1',
                metadata: { person: 'Ada' },
            });
            const second = await service.getIncludes(makeContext(), '/blog', includes, {
                useCache: true,
                version: 'v1',
                metadata: { person: 'Lin' },
            });

            assertJSONEqual({ summary: 'Hello Ada', body: 'Static body' }, first);
            assertJSONEqual({ summary: 'Hello Lin', body: 'Static body' }, second);
            assertJSONEqual([ '/blog/summary.html', '/blog/body.md' ], receivedFilepaths);
            assertEqual(1, reads);
        });

        it('omits an include whose canonical file is absent', async () => {
            const stores = makeStores();
            stores.pageDataStore.getTextFiles = async () => [
                { filepath: 'blog/body.md', source: 'Body' },
                null,
            ];
            const service = makeService(stores);

            const result = await service.getIncludes(makeContext(), '/blog', {
                body: { filename: 'body.md' },
                missing: { filename: 'missing.md' },
            });

            assertJSONEqual({ body: 'Body' }, result);
        });

        it('rejects include declarations without a filename and identifies the page and key', async () => {
            const service = makeService();
            const caught = await catchAsyncError(() => service.getIncludes(
                makeContext(),
                '/blog',
                { body: { template: true } },
            ));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('HyperviewService.getIncludes: includes[body].filename for /blog', caught.message);
        });

        it('rejects non-canonical and invalid include filenames', async () => {
            const service = makeService();

            await assertIdentifierRejected(
                () => service.getIncludes(
                    makeContext(),
                    '/blog',
                    { hero: { filename: 'Hero.md' } },
                ),
                'HyperviewService.getIncludes: includes[hero].filename for /blog',
            );
            await assertIdentifierRejected(
                () => service.getIncludes(
                    makeContext(),
                    '/blog',
                    { body: { filename: '../body.md' } },
                ),
                'HyperviewService.getIncludes: includes[body].filename for /blog',
            );
        });

        it('rejects a non-canonical pathname before reading includes', async () => {
            const stores = makeStores();
            let reads = 0;
            stores.pageDataStore.getTextFiles = async () => {
                reads += 1;
                return [];
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.getIncludes(makeContext(), '/Blog', {}),
                'HyperviewService.getIncludes: pathname',
            );
            assertEqual(0, reads);
        });
    });

    describe('template loading', ({ it }) => {
        it('compiles templates with partials and caches a missing base template', async () => {
            const stores = makeStores();
            let baseReads = 0;
            stores.templateFileStore.getBaseTemplate = async (_context, _buildId, templateId) => {
                baseReads += 1;
                if (templateId === 'missing.html') return null;
                return { filepath: 'base/site.html', source: '<main>{{> greeting.html}}</main>' };
            };
            stores.templateFileStore.getPartials = async () => [
                { filepath: 'partials/greeting.html', source: 'Hi {{ name }}' },
            ];
            const service = makeService(stores);

            const template = await service.getBaseTemplate(makeContext(), 'site.html', { useCache: true });
            assertEqual('<main>Hi Ada</main>', template({ name: 'Ada' }));
            assertEqual(null, await service.getBaseTemplate(makeContext(), 'missing.html', { useCache: true }));
            assertEqual(null, await service.getBaseTemplate(makeContext(), 'missing.html', { useCache: true }));

            assertEqual(2, baseReads);
        });

        it('loads and renders page templates', async () => {
            const stores = makeStores();
            let receivedTemplateId;
            stores.templateFileStore.getPageTemplate = async (_context, _buildId, templateId) => {
                receivedTemplateId = templateId;
                return {
                    filepath: 'pages/blog.html',
                    source: '<article>{{ page.title }}</article>',
                };
            };
            const service = makeService(stores);

            const template = await service.getPageTemplate(makeContext(), 'blog.html');

            assertEqual('blog.html', receivedTemplateId);
            assertEqual('<article>Notes</article>', template({ page: { title: 'Notes' } }));
        });

        it('rejects non-canonical template ids before reading or populating the cache', async () => {
            const stores = makeStores();
            let baseReads = 0;
            let pageReads = 0;
            stores.templateFileStore.getBaseTemplate = async () => {
                baseReads += 1;
                return null;
            };
            stores.templateFileStore.getPageTemplate = async () => {
                pageReads += 1;
                return null;
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.getBaseTemplate(makeContext(), 'Site.html', { useCache: true }),
                'HyperviewService.getBaseTemplate: templateId',
            );
            await assertIdentifierRejected(
                () => service.getPageTemplate(makeContext(), 'Blog.html', { useCache: true }),
                'HyperviewService.getPageTemplate: templateId',
            );

            assertEqual(null, await service.getBaseTemplate(makeContext(), 'site.html', { useCache: true }));
            assertEqual(null, await service.getPageTemplate(makeContext(), 'blog.html', { useCache: true }));
            assertEqual(1, baseReads);
            assertEqual(1, pageReads);
        });

        it('resolves mixed-case partial references against canonical stored names', async () => {
            const stores = makeStores();
            stores.templateFileStore.getBaseTemplate = async () => ({
                filepath: 'base/site.html',
                source: '<main>{{> Nav.html }}</main>',
            });
            stores.templateFileStore.getPartials = async () => [
                { filepath: 'partials/nav.html', source: 'Navigation' },
            ];
            const service = makeService(stores);

            const template = await service.getBaseTemplate(makeContext(), 'site.html');

            assertEqual('<main>Navigation</main>', template({}));
        });

        it('rejects non-canonical partial filepaths returned by the store', async () => {
            const stores = makeStores();
            stores.templateFileStore.getPartials = async () => [
                { filepath: 'partials/Nav.html', source: 'Navigation' },
            ];
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.loadPartials(makeContext()),
                'HyperviewService.loadPartials: partial filepath',
            );
        });
    });

    describe('publishing writes', ({ it }) => {
        it('writes page data to the page-relative logical filepaths', async () => {
            const stores = makeStores();
            const writes = [];
            stores.pageDataStore.putJSONFile = async (...args) => {
                writes.push([ 'json', ...args ]);
                return { filepath: 'blog/page.json' };
            };
            stores.pageDataStore.putTextFile = async (...args) => {
                writes.push([ 'text', ...args ]);
                return { filepath: 'blog/body.md' };
            };
            const service = makeService(stores);
            const context = makeContext();
            const metadata = { version: 'v1' };

            await service.putPageMetadata(context, 'next', '/blog/', metadata);
            await service.putIncludeContent(context, 'next', '/blog/', 'body.md', 'Content');

            assertJSONEqual([
                [ 'json', context, 'next', '/blog/page.json', metadata ],
                [ 'text', context, 'next', '/blog/body.md', 'Content' ],
            ], writes);
        });

        it('rejects non-canonical page data identifiers before writing', async () => {
            const stores = makeStores();
            let jsonWrites = 0;
            let textWrites = 0;
            stores.pageDataStore.putJSONFile = async () => {
                jsonWrites += 1;
            };
            stores.pageDataStore.putTextFile = async () => {
                textWrites += 1;
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.putPageMetadata(makeContext(), 'next', '/Blog', {}),
                'HyperviewService.putPageMetadata: pathname',
            );
            await assertIdentifierRejected(
                () => service.putIncludeContent(makeContext(), 'next', '/Blog', 'body.md', 'Body'),
                'HyperviewService.putIncludeContent: pathname',
            );
            await assertIdentifierRejected(
                () => service.putIncludeContent(makeContext(), 'next', '/blog', 'Body.md', 'Body'),
                'HyperviewService.putIncludeContent: filename',
            );

            assertEqual(0, jsonWrites);
            assertEqual(0, textWrites);
        });

        it('rejects invalid include metadata and stores valid metadata without rewriting it', async () => {
            const stores = makeStores();
            let storedMetadata;
            stores.pageDataStore.putJSONFile = async (_context, _buildId, _filepath, metadata) => {
                storedMetadata = metadata;
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.putPageMetadata(makeContext(), 'next', '/blog', {
                    includes: { hero: { filename: 'Hero.md' } },
                }),
                'HyperviewService.putPageMetadata: includes[hero].filename for /blog',
            );

            const metadata = {
                version: 'v1',
                includes: { body: { filename: 'body.md', template: true } },
            };
            await service.putPageMetadata(makeContext(), 'next', '/blog', metadata);

            assertEqual(metadata, storedMetadata);
        });

        it('rejects template writes to the current build and forwards writes to a new build', async () => {
            const stores = makeStores();
            const writes = [];
            stores.templateFileStore.putBaseTemplate = async (...args) => {
                writes.push(args);
                return { filepath: 'base/site.html' };
            };
            const service = makeService(stores);
            const context = makeContext('live');
            const caught = await catchAsyncError(() => service.putBaseTemplate(context, 'live', 'site.html', '<main/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            await service.putBaseTemplate(context, 'next', 'site.html', '<main/>');
            assertJSONEqual([ [ context, 'next', 'site.html', '<main/>' ] ], writes);
        });

        it('rejects non-canonical template identifiers before writing', async () => {
            const stores = makeStores();
            let writes = 0;
            stores.templateFileStore.putBaseTemplate = async () => {
                writes += 1;
            };
            stores.templateFileStore.putPageTemplate = async () => {
                writes += 1;
            };
            stores.templateFileStore.putPartial = async () => {
                writes += 1;
            };
            const service = makeService(stores);

            await assertIdentifierRejected(
                () => service.putBaseTemplate(makeContext(), 'next', 'Site.html', '<main/>'),
                'HyperviewService.putBaseTemplate: templateId',
            );
            await assertIdentifierRejected(
                () => service.putPageTemplate(makeContext(), 'next', 'Blog.html', '<main/>'),
                'HyperviewService.putPageTemplate: templateId',
            );
            await assertIdentifierRejected(
                () => service.putPartial(makeContext(), 'next', 'Nav.html', 'Navigation'),
                'HyperviewService.putPartial: filepath',
            );

            assertEqual(0, writes);
        });

        it('forwards canonical template identifiers unchanged', async () => {
            const stores = makeStores();
            const writes = [];
            stores.templateFileStore.putBaseTemplate = async (...args) => {
                writes.push([ 'base', ...args ]);
            };
            stores.templateFileStore.putPageTemplate = async (...args) => {
                writes.push([ 'page', ...args ]);
            };
            stores.templateFileStore.putPartial = async (...args) => {
                writes.push([ 'partial', ...args ]);
            };
            const service = makeService(stores);
            const context = makeContext();

            await service.putBaseTemplate(context, 'next', 'site.html', 'Base');
            await service.putPageTemplate(context, 'next', 'blog/post.html', 'Page');
            await service.putPartial(context, 'next', 'shared/nav.html', 'Partial');

            assertJSONEqual([
                [ 'base', context, 'next', 'site.html', 'Base' ],
                [ 'page', context, 'next', 'blog/post.html', 'Page' ],
                [ 'partial', context, 'next', 'shared/nav.html', 'Partial' ],
            ], writes);
        });
    });
});
