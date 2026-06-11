import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined, assertMatches } from 'kixx-assert';

import HyperviewService from '../../../src/kixx/hyperview/hyperview-service.js';
import Logger from '../../../src/kixx/logger/logger.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makePageDataStore(options) {
    const { jsonFiles = {}, textFiles = {}, calls } = options ?? {};

    return {
        async getJSONFiles(_context, filepaths) {
            if (calls) {
                calls.getJSONFilesCallCount = (calls.getJSONFilesCallCount || 0) + 1;
                calls.jsonFilepaths = filepaths;
            }
            return filepaths.map((filepath) => {
                const json = jsonFiles[filepath];
                return json ? { filepath, json } : null;
            });
        },
        async getTextFiles(_context, filepaths) {
            return filepaths.map((filepath) => {
                const source = textFiles[filepath];
                return source ? { filepath, source } : null;
            });
        },
        async getTextFile(_context, filepath) {
            return textFiles[filepath] ?? null;
        },
    };
}

function makeTemplateFileStore(options) {
    const { templates = {}, partials = [] } = options ?? {};

    return {
        async getTemplate(_context, templateId) {
            const source = templates[templateId];
            return source ? { filepath: `base-templates/${ templateId }`, source } : null;
        },
        async getPartials() {
            return partials;
        },
    };
}

function makeService(options) {
    const { pageDataStore, templateFileStore } = options ?? {};

    const service = new HyperviewService({ logger: makeLogger() });

    service.initialize({
        pageDataStore: pageDataStore ?? makePageDataStore(),
        templateFileStore: templateFileStore ?? makeTemplateFileStore(),
    });

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


describe('HyperviewService', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new HyperviewService({}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('initialize', ({ it }) => {
        it('throws when pageDataStore is not provided', () => {
            const service = new HyperviewService({ logger: makeLogger() });

            const caught = catchError(() => service.initialize({
                templateFileStore: makeTemplateFileStore(),
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when templateFileStore is not provided', () => {
            const service = new HyperviewService({ logger: makeLogger() });

            const caught = catchError(() => service.initialize({
                pageDataStore: makePageDataStore(),
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('getPageData', ({ describe }) => {

        describe('page hierarchy and merging', ({ it }) => {
            it('returns null when the leaf page.json does not exist', async () => {
                const service = makeService();
                const url = new URL('https://example.com/blog/post');

                const result = await service.getPageData({}, url, '/blog/post');

                assertEqual(null, result);
            });

            it('merges ancestor page.json data with descendants overriding ancestors', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': { site: { name: 'Site' }, page: { locale: 'en-US' } },
                        '/blog/page.json': { page: { locale: 'en-GB', section: 'Blog' } },
                        '/blog/post/page.json': { page: { title: 'Post Title' } },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/post');

                const data = await service.getPageData({}, url, '/blog/post');

                assertEqual('Site', data.site.name);
                assertEqual('en-GB', data.page.locale);
                assertEqual('Blog', data.page.section);
                assertEqual('Post Title', data.page.title);
            });

            it('deeply merges page data with every hierarchy level overriding earlier levels', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': {
                            page: {
                                presentation: {
                                    layout: {
                                        density: 'comfortable',
                                        width: 'wide',
                                    },
                                    theme: {
                                        palette: {
                                            primary: 'root-primary',
                                            secondary: 'root-secondary',
                                        },
                                        typography: {
                                            scale: 'root-scale',
                                        },
                                    },
                                },
                            },
                        },
                        '/blog/page.json': {
                            page: {
                                presentation: {
                                    layout: {
                                        density: 'blog-density',
                                    },
                                    theme: {
                                        palette: {
                                            primary: 'blog-primary',
                                            accent: 'blog-accent',
                                        },
                                        typography: {
                                            scale: 'blog-scale',
                                        },
                                    },
                                },
                            },
                        },
                        '/blog/reviews/page.json': {
                            page: {
                                presentation: {
                                    layout: {
                                        density: 'reviews-density',
                                    },
                                    theme: {
                                        palette: {
                                            primary: 'reviews-primary',
                                            muted: 'reviews-muted',
                                        },
                                        typography: {
                                            body: 'reviews-body',
                                        },
                                    },
                                },
                            },
                        },
                        '/blog/reviews/post/page.json': {
                            page: {
                                title: 'Post Title',
                                presentation: {
                                    theme: {
                                        palette: {
                                            primary: 'post-primary',
                                        },
                                        typography: {
                                            heading: 'post-heading',
                                        },
                                    },
                                },
                            },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/reviews/post');

                const data = await service.getPageData({}, url, '/blog/reviews/post');

                assertEqual('reviews-density', data.page.presentation.layout.density);
                assertEqual('wide', data.page.presentation.layout.width);
                assertEqual('post-primary', data.page.presentation.theme.palette.primary);
                assertEqual('root-secondary', data.page.presentation.theme.palette.secondary);
                assertEqual('blog-accent', data.page.presentation.theme.palette.accent);
                assertEqual('reviews-muted', data.page.presentation.theme.palette.muted);
                assertEqual('blog-scale', data.page.presentation.theme.typography.scale);
                assertEqual('reviews-body', data.page.presentation.theme.typography.body);
                assertEqual('post-heading', data.page.presentation.theme.typography.heading);
                assertEqual('Post Title', data.page.title);
            });

            it('skips ancestor page.json files that do not exist', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': { site: { name: 'Site' } },
                        '/blog/post/page.json': { page: { title: 'Post Title' } },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/post');

                const data = await service.getPageData({}, url, '/blog/post');

                assertEqual('Site', data.site.name);
                assertEqual('Post Title', data.page.title);
            });

            it('merges props last so they override merged page data', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': { page: { title: 'Default Title', locale: 'en-US' } },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const data = await service.getPageData({}, url, '/', { page: { title: 'Override Title' } });

                assertEqual('Override Title', data.page.title);
                assertEqual('en-US', data.page.locale);
            });

            it('requests page.json for the root and every ancestor segment', async () => {
                const calls = {};
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/blog/reviews/post/page.json': { page: { title: 'Post' } },
                    },
                    calls,
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/reviews/post');

                await service.getPageData({}, url, '/blog/reviews/post');

                assertEqual(4, calls.jsonFilepaths.length);
                assertEqual('/page.json', calls.jsonFilepaths[0]);
                assertEqual('/blog/page.json', calls.jsonFilepaths[1]);
                assertEqual('/blog/reviews/page.json', calls.jsonFilepaths[2]);
                assertEqual('/blog/reviews/post/page.json', calls.jsonFilepaths[3]);
            });
        });

        describe('caching', ({ it }) => {
            it('reuses cached page data on subsequent calls for the same pathname', async () => {
                const calls = {};
                const pageDataStore = makePageDataStore({
                    jsonFiles: { '/page.json': { page: { title: 'Home' } } },
                    calls,
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const first = await service.getPageData({}, url, '/', null, { useCache: true });
                const second = await service.getPageData({}, url, '/', null, { useCache: true });

                assertEqual(first, second);
                assertEqual(1, calls.getJSONFilesCallCount);
            });

            it('caches a null result for a missing page', async () => {
                const calls = {};
                const pageDataStore = makePageDataStore({ jsonFiles: {}, calls });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/missing');

                const first = await service.getPageData({}, url, '/missing', null, { useCache: true });
                const second = await service.getPageData({}, url, '/missing', null, { useCache: true });

                assertEqual(null, first);
                assertEqual(null, second);
                assertEqual(1, calls.getJSONFilesCallCount);
            });

            it('does not use the cache when props are provided', async () => {
                const calls = {};
                const pageDataStore = makePageDataStore({
                    jsonFiles: { '/page.json': { page: { title: 'Home' } } },
                    calls,
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                await service.getPageData({}, url, '/', null, { useCache: true });
                await service.getPageData({}, url, '/', { page: { title: 'Override' } }, { useCache: true });

                assertEqual(2, calls.getJSONFilesCallCount);
            });
        });

        describe('page metadata', ({ it }) => {
            it('sets canonical_url from the request URL when not provided', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: { '/blog/post/page.json': { page: {} } },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/post?query=1#section');

                const data = await service.getPageData({}, url, '/blog/post');

                assertEqual('https://example.com/blog/post', data.page.canonical_url);
            });

            it('does not override an existing canonical_url', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': { page: { canonical_url: 'https://custom.example/canonical' } },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const data = await service.getPageData({}, url, '/');

                assertEqual('https://custom.example/canonical', data.page.canonical_url);
            });

            it('sets href from url.href when not provided', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: { '/page.json': { page: {} } },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/?query=1#section');

                const data = await service.getPageData({}, url, '/');

                assertEqual(url.href, data.page.href);
            });

            it('renders page.title from a template using the assembled page data', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': {
                            site: { name: 'My Site' },
                            page: { title: { template: '{{site.name}} Home' } },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const data = await service.getPageData({}, url, '/');

                assertEqual('My Site Home', data.page.title);
            });

            it('renders page.description from a template using the assembled page data', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': {
                            page: {
                                title: 'Welcome',
                                description: { template: '{{page.title}} - learn more' },
                            },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const data = await service.getPageData({}, url, '/');

                assertEqual('Welcome - learn more', data.page.description);
            });

            it('creates default open_graph values from page data', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': {
                            page: {
                                title: 'My Title',
                                description: 'My Description',
                                locale: 'en-US',
                            },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const data = await service.getPageData({}, url, '/');

                assertEqual('https://example.com/', data.page.open_graph.url);
                assertEqual('website', data.page.open_graph.type);
                assertEqual('My Title', data.page.open_graph.title);
                assertEqual('My Description', data.page.open_graph.description);
                assertEqual('en-US', data.page.open_graph.locale);
            });

            it('preserves existing open_graph values', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': {
                            page: {
                                title: 'My Title',
                                open_graph: { title: 'OG Title', type: 'article' },
                            },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const data = await service.getPageData({}, url, '/');

                assertEqual('OG Title', data.page.open_graph.title);
                assertEqual('article', data.page.open_graph.type);
                assertEqual('https://example.com/', data.page.open_graph.url);
                assertUndefined(data.page.open_graph.description);
            });
        });

        describe('includes', ({ it }) => {
            it('throws when an include is missing its filename', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/page.json': {
                            includes: { header: { template: true } },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/');

                const caught = await catchAsyncError(() => service.getPageData({}, url, '/'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('Missing includes[header].filename', caught.message);
            });

            it('renders template includes with the assembled page data', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/blog/post/page.json': {
                            page: { title: 'Hello' },
                            includes: { header: { filename: 'header.html', template: true } },
                        },
                    },
                    textFiles: {
                        '/blog/post/header.html': 'Header: {{page.title}}',
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/post');

                const data = await service.getPageData({}, url, '/blog/post');

                assertEqual('Header: Hello', data.includes.header);
            });

            it('uses the raw source for non-template includes', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/blog/post/page.json': {
                            includes: { footer: { filename: 'footer.md' } },
                        },
                    },
                    textFiles: {
                        '/blog/post/footer.md': 'Footer text',
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/post');

                const data = await service.getPageData({}, url, '/blog/post');

                assertEqual('Footer text', data.includes.footer);
            });

            it('leaves the include entry unchanged when the included file does not exist', async () => {
                const pageDataStore = makePageDataStore({
                    jsonFiles: {
                        '/blog/post/page.json': {
                            includes: { missing: { filename: 'missing.html', template: true } },
                        },
                    },
                });

                const service = makeService({ pageDataStore });
                const url = new URL('https://example.com/blog/post');

                const data = await service.getPageData({}, url, '/blog/post');

                assertEqual('missing.html', data.includes.missing.filename);
                assertEqual(true, data.includes.missing.template);
            });
        });
    });

    describe('getBaseTemplate', ({ it }) => {
        it('returns null when the base template does not exist', async () => {
            const service = makeService();

            const result = await service.getBaseTemplate({}, 'missing.html');

            assertEqual(null, result);
        });

        it('compiles and renders the base template with partials', async () => {
            const templateFileStore = makeTemplateFileStore({
                templates: { 'default.html': '<body>{{> nav.html}}{{title}}</body>' },
                partials: [
                    { filepath: 'partials/nav.html', source: '<nav>Menu</nav>' },
                ],
            });

            const service = makeService({ templateFileStore });

            const template = await service.getBaseTemplate({}, 'default.html');
            const html = template({ title: 'Home' });

            assertEqual('<body><nav>Menu</nav>Home</body>', html);
        });
    });

    describe('getPageTemplate', ({ it }) => {
        it('returns null when the page template does not exist', async () => {
            const service = makeService();

            const result = await service.getPageTemplate({}, '/blog/post', 'page.html');

            assertEqual(null, result);
        });

        it('compiles and renders a page template located under the page pathname', async () => {
            const pageDataStore = makePageDataStore({
                textFiles: { '/blog/post/page.html': '<h1>{{page.title}}</h1>' },
            });

            const service = makeService({ pageDataStore });

            const template = await service.getPageTemplate({}, '/blog/post', 'page.html');
            const html = template({ page: { title: 'Hello' } });

            assertEqual('<h1>Hello</h1>', html);
        });

        it('resolves the template path for the root pathname', async () => {
            const pageDataStore = makePageDataStore({
                textFiles: { '/page.html': 'root template' },
            });

            const service = makeService({ pageDataStore });

            const template = await service.getPageTemplate({}, '/', 'page.html');

            assertEqual('root template', template({}));
        });
    });

    describe('loadPartials', ({ it }) => {
        it('compiles partials keyed by name with the partials/ prefix stripped', async () => {
            const templateFileStore = makeTemplateFileStore({
                partials: [
                    { filepath: 'partials/nav.html', source: 'NAV' },
                ],
            });

            const service = makeService({ templateFileStore });

            const partials = await service.loadPartials({});

            assertEqual('NAV', partials.get('nav.html')({}));
        });
    });

    describe('compileTemplate', ({ it }) => {
        it('compiles template source into a render function', () => {
            const service = makeService();

            const template = service.compileTemplate('test.html', 'Hello {{name}}', new Map(), new Map());

            assertEqual('Hello World', template({ name: 'World' }));
        });

        it('lets custom helpers override built-in helpers with the same key', () => {
            const service = makeService();
            const customHelpers = new Map([
                [ 'if', () => 'overridden' ],
            ]);

            const template = service.compileTemplate('test.html', '{{#if value}}yes{{/if}}', customHelpers, new Map());

            assertEqual('overridden', template({ value: false }));
        });
    });
});
