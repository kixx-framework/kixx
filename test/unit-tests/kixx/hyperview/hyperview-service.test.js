import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertMatches,
    assertNotEqual,
} from 'kixx-assert';

import HyperviewService from '../../../../src/kixx/hyperview/hyperview-service.js';
import {
    JsonContentObject,
    TextContentObject,
} from '../../../../src/kixx/content-addressable-store/content-object.js';
import ServerResponse from '../../../../src/kixx/http-router/server-response.js';
import {
    isValidPathname,
    normalizePathname,
} from '../../../../src/kixx/content-addressable-store/content-layout.js';


// A sentinel rather than a real RequestContext. Every content read is supposed
// to receive this exact object, so identity is what the tests assert on.
const CONTEXT = { name: 'test-request-context' };


function catchAsyncError(fn) {
    return fn().then(
        () => null,
        (error) => error,
    );
}

function makeStats(pathname, hash) {
    return { pathname, hash, size: 0, metadata: null };
}

function makeJsonObject(pathname, hash, value) {
    return new JsonContentObject(JSON.stringify(value), makeStats(pathname, hash));
}

function makeTextObject(pathname, hash, text) {
    return new TextContentObject(text, makeStats(pathname, hash));
}

function makeLogger() {
    const noop = () => {};
    const child = { debug: noop, info: noop, warn: noop, error: noop };
    return { createChild: () => child };
}

/**
 * A fake ContentSnapshot.
 *
 * The spec describes published content in the shape a test wants to talk about;
 * this converts it into the ContentObject instances the real snapshot returns,
 * and records every call so the tests can assert on the context argument and on
 * how often the service went back to the store.
 */
function makeContentSnapshot(spec) {
    const {
        pages = {},
        globalPartials = null,
        globalPartialsHash = 'global-partials-hash-1',
        baseTemplates = null,
        baseTemplatesHash = 'base-templates-hash-1',
        staticAssets = null,
        staticAssetsHash = 'static-assets-hash-1',
        emails = {},
    } = spec ?? {};

    const calls = [];
    let listStaticAssetsCalls = 0;

    function record(method, context, pathname) {
        calls.push({ method, context, pathname });
    }

    return {
        calls,

        get listStaticAssetsCalls() {
            return listStaticAssetsCalls;
        },

        callsTo(method) {
            return calls.filter((entry) => entry.method === method);
        },

        statGlobalTemplatePartials() {
            if (!globalPartials) {
                return null;
            }
            return makeStats('/templates/partials.json', globalPartialsHash);
        },

        async getGlobalTemplatePartials(context) {
            record('getGlobalTemplatePartials', context);
            if (!globalPartials) {
                return null;
            }
            return makeJsonObject('/templates/partials.json', globalPartialsHash, globalPartials);
        },

        statBaseTemplates() {
            if (!baseTemplates) {
                return null;
            }
            return makeStats('/templates/base-templates.json', baseTemplatesHash);
        },

        async getBaseTemplates(context) {
            record('getBaseTemplates', context);
            if (!baseTemplates) {
                return null;
            }
            return makeJsonObject('/templates/base-templates.json', baseTemplatesHash, baseTemplates);
        },

        statStaticAssets() {
            if (!staticAssets) {
                return null;
            }
            return makeStats('/assets', staticAssetsHash);
        },

        listStaticAssets() {
            listStaticAssetsCalls += 1;
            return staticAssets ?? [];
        },

        async batchGetPageAssets(context, pathname) {
            record('batchGetPageAssets', context, pathname);

            const page = pages[pathname];
            if (!page) {
                return null;
            }

            const hash = page.hash ?? `${ pathname }-hash-1`;
            const directory = pathname === '/' ? '' : pathname;

            const pageDataFiles = (page.pageData ?? []).map((json, index) => {
                return makeJsonObject(`/pages${ directory }/page.json#${ index }`, `${ hash }-data-${ index }`, json);
            });

            let template = null;
            if (page.template) {
                template = makeTextObject(
                    `/pages${ directory }/page.html`,
                    page.templateHash ?? `${ hash }-template`,
                    page.template,
                );
            }

            let partials = null;
            if (page.partials) {
                partials = makeJsonObject(
                    `/pages${ directory }/partials.json`,
                    page.partialsHash ?? `${ hash }-partials`,
                    page.partials,
                );
            }

            let includes = null;
            if (page.includes) {
                includes = makeJsonObject(
                    `/pages${ directory }/includes.json`,
                    `${ hash }-includes`,
                    page.includes,
                );
            }

            return { hash, pageDataFiles, template, partials, includes };
        },

        async getEmailAssets(context, pathname) {
            record('getEmailAssets', context, pathname);

            const email = emails[pathname];
            if (!email) {
                return null;
            }

            return makeJsonObject(
                `/emails${ pathname }.json`,
                email.hash ?? `${ pathname }-email-hash`,
                email.bundle,
            );
        },
    };
}

// A fake ContentAddressableStore. The pure pathname and hashing methods
// delegate to nothing platform-specific, so they are implemented here in the
// same terms the real store uses rather than mocked away.
function makeContentAddressableStore(snapshot) {
    return {
        snapshot,

        openSnapshotCalls: [],

        normalizePathname,

        isValidPathname,

        async hashString(value) {
            return `H(${ value })`;
        },

        async hashSet(value) {
            return `S(${ JSON.stringify(value) })`;
        },

        async openSnapshot(context) {
            this.openSnapshotCalls.push(context);
            return snapshot;
        },
    };
}

function makeKvStore(seed) {
    const store = new Map(Object.entries(seed ?? {}));
    const gets = [];
    const puts = [];

    return {
        gets,
        puts,

        async get(context, key, options) {
            gets.push({ context, key, options });
            return store.has(key) ? store.get(key) : null;
        },

        async put(context, key, value, options) {
            puts.push({ context, key, value, options });
            store.set(key, value);
        },
    };
}

function makeRequest(href) {
    return { url: new URL(href ?? 'https://www.example.com/') };
}

function makeSubject(spec, options) {
    const snapshot = makeContentSnapshot(spec);
    const contentAddressableStore = makeContentAddressableStore(snapshot);
    const kvStore = makeKvStore(options?.kvSeed);

    const service = new HyperviewService({
        logger: makeLogger(),
        ...options?.serviceOptions,
    });

    service.initialize({ contentAddressableStore, kvStore });

    return { service, snapshot, contentAddressableStore, kvStore };
}

// The content spec every render-mode test starts from: one page with its own
// template and partials, one global partial the page overrides, and one base
// template.
function makeDefaultSpec() {
    return {
        pages: {
            '/': {
                pageData: [{ page: { title: 'Home' } }],
                template: '<main>{{> byline }}{{> footer }}</main>',
                partials: [
                    { id: 'byline', source: '<p>{{ page.title }}</p>' },
                ],
            },
        },
        globalPartials: [
            { id: 'byline', source: '<p>GLOBAL BYLINE</p>' },
            { id: 'footer', source: '<footer>{{ page.title }}</footer>' },
        ],
        baseTemplates: [
            { id: 'main', source: '<html><body>{{{ body }}}</body></html>' },
        ],
    };
}

function makeFullPageOptions(overrides) {
    return { baseTemplateId: 'main', ...overrides };
}


describe('HyperviewService', ({ describe }) => {

    describe('renderPage() full page render', ({ it }) => {

        it('requires a URL and plain runtime props', async () => {
            const { service } = makeSubject(makeDefaultSpec());

            const withoutUrl = await catchAsyncError(() => service.renderPage(CONTEXT, { props: {} }));
            const withoutProps = await catchAsyncError(() => service.renderPage(CONTEXT, {
                url: makeRequest().url,
            }));

            assertEqual('AssertionError', withoutUrl.name);
            assertMatches('options.url', withoutUrl.message);
            assertEqual('AssertionError', withoutProps.name);
            assertMatches('options.props', withoutProps.message);
        });

        it('wraps the rendered page template in the base template', async () => {
            const { service } = makeSubject(makeDefaultSpec());
            const result = await service.renderPage(
                CONTEXT,
                {
                    ...makeFullPageOptions(),
                    props: {},
                    url: makeRequest().url,
                },
            );

            assertEqual('hypertext', result.type);
            assertEqual(
                '<html><body><main><p>Home</p><footer>Home</footer></main></body></html>',
                result.hypertext,
            );
        });

        it('passes the request context to every content read', async () => {
            const { snapshot } = await renderDefaultPage();

            assert(snapshot.calls.length > 0, 'expected content reads');

            for (const call of snapshot.calls) {
                assertEqual(CONTEXT, call.context, `${ call.method } received the context`);
            }
        });

        it('reads the page assets under the normalized request pathname', async () => {
            const { snapshot } = await renderDefaultPage({ href: 'https://www.example.com/' });

            assertEqual('/', snapshot.callsTo('batchGetPageAssets')[0].pathname);
        });

        it('layers page partials over global partials of the same name', async () => {
            const { service } = makeSubject(makeDefaultSpec());
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            // The page publishes its own "byline"; the global bundle's is shadowed.
            assertMatches('<p>Home</p>', response.body);
            assertFalsy(response.body.includes('GLOBAL BYLINE'));
            // "footer" exists only globally, so it still resolves.
            assertMatches('<footer>Home</footer>', response.body);
        });

        it('exposes the published includes content to the template', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].template = '<main>{{ includes.intro }}</main>';
            spec.pages['/'].includes = { intro: 'An introduction.' };

            const { service } = makeSubject(spec);
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('An introduction.', response.body);
        });

        it('renders an empty string for includes when the page publishes none', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].template = '<main>[{{ includes.intro }}]</main>';

            const { service } = makeSubject(spec);
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('<main>[]</main>', response.body);
        });

        it('renders response props into the page context', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].template = '<main>{{ greeting }}</main>';

            const { service } = makeSubject(spec);
            const response = new ServerResponse();
            response.updateProps({ greeting: 'Hello' });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('<main>Hello</main>', response.body);
        });

        it('returns a value without accepting or mutating a response', async () => {
            const { service } = makeSubject(makeDefaultSpec());
            const response = new ServerResponse();
            response.status = 404;

            const result = await service.renderPage(
                CONTEXT,
                {
                    ...makeFullPageOptions(),
                    props: response.props,
                    url: makeRequest().url,
                },
            );

            assertEqual('hypertext', result.type);
            assertEqual(404, response.status);
            assertEqual(null, response.body);
        });

        it('throws NotFoundError when no page is published at the pathname', async () => {
            const { service } = makeSubject(makeDefaultSpec());

            const caught = await catchAsyncError(() => {
                return renderPageToResponse(service,
                    CONTEXT,
                    makeRequest('https://www.example.com/missing'),
                    new ServerResponse(),
                    makeFullPageOptions(),
                );
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
            assertMatches('/missing', caught.message);
        });

        it('throws NotFoundError when the page directory publishes no template', async () => {
            // An ancestor directory may publish metadata to supply defaults for its
            // descendants without being a page in its own right.
            const spec = makeDefaultSpec();
            spec.pages['/blog'] = { pageData: [{ page: { title: 'Blog' } }] };

            const { service } = makeSubject(spec);

            const caught = await catchAsyncError(() => {
                return renderPageToResponse(service,
                    CONTEXT,
                    makeRequest('https://www.example.com/blog'),
                    new ServerResponse(),
                    makeFullPageOptions(),
                );
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
        });

        it('throws when the requested base template is not published', async () => {
            const { service } = makeSubject(makeDefaultSpec());

            const caught = await catchAsyncError(() => {
                return renderPageToResponse(service,
                    CONTEXT,
                    makeRequest(),
                    new ServerResponse(),
                    makeFullPageOptions({ baseTemplateId: 'nope' }),
                );
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('nope', caught.message);
        });
    });

    describe('renderPage() partial render', ({ it }) => {

        it('renders only the named page partial', async () => {
            const { service } = makeSubject(makeDefaultSpec());
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                { partial: 'byline' },
            );

            assertEqual('<p>Home</p>', response.body);
        });

        it('resolves partials referenced from within the rendered partial', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].partials = [
                { id: 'byline', source: '<p>{{ page.title }}{{> footer }}</p>' },
            ];

            const { service } = makeSubject(spec);
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                { partial: 'byline' },
            );

            assertEqual('<p>Home<footer>Home</footer></p>', response.body);
        });

        it('never reads the base templates', async () => {
            const { service, snapshot } = makeSubject(makeDefaultSpec());

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                new ServerResponse(),
                { partial: 'byline' },
            );

            assertEqual(0, snapshot.callsTo('getBaseTemplates').length);
        });

        it('throws when the named partial is not published by the page', async () => {
            const { service } = makeSubject(makeDefaultSpec());

            const caught = await catchAsyncError(() => {
                return renderPageToResponse(service,
                    CONTEXT,
                    makeRequest(),
                    new ServerResponse(),
                    { partial: 'nope' },
                );
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('nope', caught.message);
        });
    });

    describe('renderPage() skipBaseRender', ({ it }) => {

        it('renders the page template without the surrounding document', async () => {
            const { service } = makeSubject(makeDefaultSpec());
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                { skipBaseRender: true },
            );

            assertEqual('<main><p>Home</p><footer>Home</footer></main>', response.body);
        });

        it('never reads the base templates', async () => {
            const { service, snapshot } = makeSubject(makeDefaultSpec());

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                new ServerResponse(),
                { skipBaseRender: true },
            );

            assertEqual(0, snapshot.callsTo('getBaseTemplates').length);
        });
    });

    describe('renderPage() metadata mini templates', ({ it }) => {

        it('renders a templated page title against the merged context', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].pageData = [
                {
                    page: { title: { template: '{{ author }} — Example' } },
                    author: 'Rakim',
                },
            ];
            spec.pages['/'].template = '<main>{{ page.title }}</main>';

            const { service } = makeSubject(spec);
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('<main>Rakim — Example</main>', response.body);
        });

        it('renders a templated title against values supplied by response props', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].pageData = [
                { page: { title: { template: 'Post: {{ post.name }}' } } },
            ];
            spec.pages['/'].template = '<main>{{ page.title }}</main>';

            const { service } = makeSubject(spec);
            const response = new ServerResponse();
            response.updateProps({ post: { name: 'Follow the Leader' } });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('<main>Post: Follow the Leader</main>', response.body);
        });

        it('renders a templated page description', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].pageData = [
                {
                    page: { description: { template: 'About {{ subject }}' } },
                    subject: 'hypermedia',
                },
            ];
            spec.pages['/'].template = '<main>{{ page.description }}</main>';

            const { service } = makeSubject(spec);
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('<main>About hypermedia</main>', response.body);
        });

        it('leaves a plain-string title untouched', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].template = '<main>{{ page.title }}</main>';

            const { service } = makeSubject(spec);
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(),
            );

            assertMatches('<main>Home</main>', response.body);
        });
    });

    describe('renderPage() JSON response', ({ it }) => {

        it('returns the assembled page context for a ".json" pathname', async () => {
            const { service } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { allowJsonResponse: true },
            });
            const result = await service.renderPage(
                CONTEXT,
                {
                    ...makeFullPageOptions(),
                    props: {},
                    url: makeRequest('https://www.example.com/index.json').url,
                },
            );

            assertEqual('page-context', result.type);
            assertEqual('Home', result.pageContext.page.title);
            assertEqual('/', result.pageContext.pathname);
        });

        it('carries the includes content in the JSON context', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].includes = { intro: 'An introduction.' };

            const { service } = makeSubject(spec, {
                serviceOptions: { allowJsonResponse: true },
            });
            const response = new ServerResponse();

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest('https://www.example.com/index.json'),
                response,
                makeFullPageOptions(),
            );

            const context = JSON.parse(response.body);
            assertEqual('An introduction.', context.includes.intro);
        });

        it('does not strip the ".json" suffix when JSON responses are disabled', async () => {
            // With the suffix left in place the pathname names no published page,
            // which is the behavior that keeps the affordance off by default.
            const { service } = makeSubject(makeDefaultSpec());

            const caught = await catchAsyncError(() => {
                return renderPageToResponse(service,
                    CONTEXT,
                    makeRequest('https://www.example.com/index.json'),
                    new ServerResponse(),
                    makeFullPageOptions(),
                );
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
        });

        it('renders hypertext when the client asks by Accept header alone', async () => {
            // There is no content negotiation: only the pathname suffix selects JSON.
            const { service } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { allowJsonResponse: true },
            });
            const request = makeRequest();
            request.headers = new Headers({ accept: 'application/json' });
            const response = new ServerResponse();

            await renderPageToResponse(service, CONTEXT, request, response, makeFullPageOptions());

            assertMatches('<html>', response.body);
        });

        it('never reads or writes the page cache', async () => {
            const { service, kvStore } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { allowJsonResponse: true, usePageCache: true },
            });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest('https://www.example.com/index.json'),
                new ServerResponse(),
                makeFullPageOptions(),
            );

            assertEqual(0, kvStore.gets.length);
            assertEqual(0, kvStore.puts.length);
        });
    });

    describe('static asset context', ({ it }) => {
        it('builds one asset map per assets tree hash across renders', async () => {
            const spec = makeDefaultSpec();
            spec.staticAssets = [ { pathname: '/site.css', hash: 'asset-hash' } ];
            const { service, snapshot } = makeSubject(spec);

            await renderPageToResponse(service, CONTEXT, makeRequest(), new ServerResponse(), makeFullPageOptions());
            await renderPageToResponse(service, CONTEXT, makeRequest(), new ServerResponse(), makeFullPageOptions());

            assertEqual(1, snapshot.listStaticAssetsCalls);
        });

        it('resolves assetUrl in an each section and a partial', async () => {
            const spec = makeDefaultSpec();
            spec.staticAssets = [ { pathname: '/site.css', hash: 'asset-hash' } ];
            spec.pages['/'].pageData = [ { values: [ { path: '/site.css' } ] } ];
            spec.pages['/'].template = '{{#each values as |item| }}{{ assetUrl assets item.path }}{{/each}}{{> asset }}';
            spec.pages['/'].partials = [ { id: 'asset', source: '{{ assetUrl assets "/site.css" }}' } ];
            spec.baseTemplates = [ { id: 'main', source: '{{{ body }}}' } ];
            const { service } = makeSubject(spec);

            const result = await service.renderPage(CONTEXT, {
                ...makeFullPageOptions(),
                props: {},
                url: makeRequest().url,
            });

            assertEqual('/assets/asset-hash/site.css/assets/asset-hash/site.css', result.hypertext);
        });
    });

    describe('renderPage() page cache', ({ it }) => {

        async function renderForCacheKey(options, spec) {
            const { service, kvStore } = makeSubject(spec ?? makeDefaultSpec(), {
                serviceOptions: { usePageCache: true },
            });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                new ServerResponse(),
                options,
            );

            assertEqual(1, kvStore.puts.length);
            return kvStore.puts[0].key;
        }

        it('writes the rendered page under a hashed key', async () => {
            const key = await renderForCacheKey(makeFullPageOptions());

            assertMatches('hyperview_page_cache#', key);
        });

        it('gives the three render modes three distinct keys for one URL', async () => {
            const fullPage = await renderForCacheKey(makeFullPageOptions());
            const pageTemplate = await renderForCacheKey({ skipBaseRender: true });
            const partial = await renderForCacheKey({ partial: 'byline' });

            assertNotEqual(fullPage, pageTemplate);
            assertNotEqual(fullPage, partial);
            assertNotEqual(pageTemplate, partial);
        });

        it('gives two partials of one page distinct keys', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].partials = [
                { id: 'byline', source: '<p>{{ page.title }}</p>' },
                { id: 'aside', source: '<aside>{{ page.title }}</aside>' },
            ];

            const byline = await renderForCacheKey({ partial: 'byline' }, spec);
            const aside = await renderForCacheKey({ partial: 'aside' }, spec);

            assertNotEqual(byline, aside);
        });

        it('changes the key when the page content changes', async () => {
            const before = await renderForCacheKey(makeFullPageOptions());

            const spec = makeDefaultSpec();
            spec.pages['/'].hash = 'a-different-page-hash';
            const after = await renderForCacheKey(makeFullPageOptions(), spec);

            assertNotEqual(before, after);
        });

        it('changes the key when the global partial bundle changes', async () => {
            // page.hash covers only the page's own files, so the shared bundle has
            // to be folded in separately or an edited global partial would keep
            // serving the old output.
            const before = await renderForCacheKey(makeFullPageOptions());

            const spec = makeDefaultSpec();
            spec.globalPartialsHash = 'global-partials-hash-2';
            const after = await renderForCacheKey(makeFullPageOptions(), spec);

            assertNotEqual(before, after);
        });

        it('changes the key when only the static assets tree changes', async () => {
            const before = await renderForCacheKey(makeFullPageOptions());

            const spec = makeDefaultSpec();
            spec.staticAssets = [ { pathname: '/site.css', hash: 'asset-hash' } ];
            spec.staticAssetsHash = 'static-assets-hash-2';
            const after = await renderForCacheKey(makeFullPageOptions(), spec);

            assertNotEqual(before, after);
        });

        it('changes the full-page key when the base template bundle changes', async () => {
            const before = await renderForCacheKey(makeFullPageOptions());

            const spec = makeDefaultSpec();
            spec.baseTemplatesHash = 'base-templates-hash-2';
            const after = await renderForCacheKey(makeFullPageOptions(), spec);

            assertNotEqual(before, after);
        });

        it('leaves the page-template key unchanged when the base templates change', async () => {
            // Only a full-page render depends on the base template bundle.
            const before = await renderForCacheKey({ skipBaseRender: true });

            const spec = makeDefaultSpec();
            spec.baseTemplatesHash = 'base-templates-hash-2';
            const after = await renderForCacheKey({ skipBaseRender: true }, spec);

            assertEqual(before, after);
        });

        it('changes the key when the base template id changes', async () => {
            const spec = makeDefaultSpec();
            spec.baseTemplates = [
                { id: 'main', source: '<html><body>{{{ body }}}</body></html>' },
                { id: 'bare', source: '<html>{{{ body }}}</html>' },
            ];

            const main = await renderForCacheKey(makeFullPageOptions(), spec);
            const bare = await renderForCacheKey(makeFullPageOptions({ baseTemplateId: 'bare' }), spec);

            assertNotEqual(main, bare);
        });

        it('returns the cached hypertext without rendering on a hit', async () => {
            const { service, kvStore } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { usePageCache: true },
            });

            const first = new ServerResponse();
            await renderPageToResponse(service, CONTEXT, makeRequest(), first, makeFullPageOptions());

            const key = kvStore.puts[0].key;
            const seeded = makeSubject(makeDefaultSpec(), {
                serviceOptions: { usePageCache: true },
                kvSeed: { [key]: 'CACHED OUTPUT' },
            });

            const second = new ServerResponse();
            await renderPageToResponse(seeded.service,
                CONTEXT,
                makeRequest(),
                second,
                makeFullPageOptions(),
            );

            assertEqual('CACHED OUTPUT', second.body);
            assertEqual(0, seeded.kvStore.puts.length);
            // A hit still costs the page read, because the page hash is part of
            // the key it was looked up by.
            assertEqual(0, seeded.snapshot.callsTo('getBaseTemplates').length);
        });

        it('reads with the configured cache TTL', async () => {
            const { service, kvStore } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { usePageCache: true, pageCacheReadTtlSeconds: 60 },
            });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                new ServerResponse(),
                makeFullPageOptions(),
            );

            assertEqual(60, kvStore.gets[0].options.cacheTtl);
        });

        it('writes with the configured expiration', async () => {
            const { service, kvStore } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { usePageCache: true, pageCacheExpirationSeconds: 120 },
            });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                new ServerResponse(),
                makeFullPageOptions(),
            );

            assertEqual(120, kvStore.puts[0].options.ttlSeconds);
        });

        it('neither reads nor writes when the page cache is off', async () => {
            const { service, kvStore } = makeSubject(makeDefaultSpec());

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                new ServerResponse(),
                makeFullPageOptions(),
            );

            assertEqual(0, kvStore.gets.length);
            assertEqual(0, kvStore.puts.length);
        });

        it('uses a custom cacheKey in place of the URL', async () => {
            const fromUrl = await renderForCacheKey(makeFullPageOptions());
            const custom = await renderForCacheKey(makeFullPageOptions({ cacheKey: 'custom-identity' }));

            assertNotEqual(fromUrl, custom);
        });

        it('distinguishes two URLs of the same page by query string', async () => {
            const { service, kvStore } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { usePageCache: true },
            });

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest('https://www.example.com/?page=1'),
                new ServerResponse(),
                makeFullPageOptions(),
            );
            await renderPageToResponse(service,
                CONTEXT,
                makeRequest('https://www.example.com/?page=2'),
                new ServerResponse(),
                makeFullPageOptions(),
            );

            assertNotEqual(kvStore.puts[0].key, kvStore.puts[1].key);
        });
    });

    describe('renderPage() props in the page cache key', ({ it }) => {

        async function keyForProps(props, options) {
            const { service, kvStore } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { usePageCache: true },
            });
            const response = new ServerResponse();
            response.updateProps(props);

            await renderPageToResponse(service,
                CONTEXT,
                makeRequest(),
                response,
                makeFullPageOptions(options),
            );

            return kvStore.puts[0].key;
        }

        it('includes the props by default whenever the page cache is on', async () => {
            // This default is a safety property, not an optimization: without it a
            // page rendered for one signed-in user is served to the next.
            const alice = await keyForProps({ viewer: 'alice' });
            const bob = await keyForProps({ viewer: 'bob' });

            assertNotEqual(alice, bob);
        });

        it('produces one key for equal props', async () => {
            const first = await keyForProps({ viewer: 'alice' });
            const second = await keyForProps({ viewer: 'alice' });

            assertEqual(first, second);
        });

        it('collapses differing props into one key when explicitly disabled', async () => {
            const alice = await keyForProps({ viewer: 'alice' }, { includePropsInCacheKey: false });
            const bob = await keyForProps({ viewer: 'bob' }, { includePropsInCacheKey: false });

            assertEqual(alice, bob);
        });

        it('uses a supplied propsHashFunction to derive the props component', async () => {
            const seen = [];

            function propsHashFunction(pathname, pageContext, props) {
                seen.push({ pathname, pageContext, props });
                return 'CONSTANT';
            }

            const alice = await keyForProps({ viewer: 'alice' }, { propsHashFunction });
            const bob = await keyForProps({ viewer: 'bob' }, { propsHashFunction });

            assertEqual(alice, bob);
            assertEqual('/', seen[0].pathname);
            assertEqual('alice', seen[0].props.viewer);
            assertEqual('Home', seen[0].pageContext.page.title);
        });
    });

    describe('renderPage() template cache', ({ it }) => {

        it('re-reads the shared bundles on every render when the cache is off', async () => {
            const { service, snapshot } = makeSubject(makeDefaultSpec());

            await renderTwice(service);

            assertEqual(2, snapshot.callsTo('getGlobalTemplatePartials').length);
            assertEqual(2, snapshot.callsTo('getBaseTemplates').length);
        });

        it('reads the shared bundles once when the cache is on', async () => {
            const { service, snapshot } = makeSubject(makeDefaultSpec(), {
                serviceOptions: { useTemplateCache: true },
            });

            await renderTwice(service);

            assertEqual(1, snapshot.callsTo('getGlobalTemplatePartials').length);
            assertEqual(1, snapshot.callsTo('getBaseTemplates').length);
        });

        it('re-reads a bundle whose content hash changed', async () => {
            const service = makeSubject(makeDefaultSpec(), {
                serviceOptions: { useTemplateCache: true },
            }).service;

            // A second snapshot standing in for a later publication. The service
            // holds the compiled cache across both, keyed by content hash.
            const republished = makeContentSnapshot({
                ...makeDefaultSpec(),
                globalPartialsHash: 'global-partials-hash-2',
            });

            await renderWithSnapshot(service, makeContentSnapshot(makeDefaultSpec()));
            await renderWithSnapshot(service, republished);

            assertEqual(1, republished.callsTo('getGlobalTemplatePartials').length);
        });

        it('serves a compiled bundle from the cache when an older hash comes back', async () => {
            // A request pinned to an older snapshot must still find its compiled
            // templates after a newer bundle has been published.
            const service = makeSubject(makeDefaultSpec(), {
                serviceOptions: { useTemplateCache: true },
            }).service;

            await renderWithSnapshot(service, makeContentSnapshot(makeDefaultSpec()));
            await renderWithSnapshot(service, makeContentSnapshot({
                ...makeDefaultSpec(),
                globalPartialsHash: 'global-partials-hash-2',
            }));

            const original = makeContentSnapshot(makeDefaultSpec());
            await renderWithSnapshot(service, original);

            assertEqual(0, original.callsTo('getGlobalTemplatePartials').length);
        });

        it('evicts the least recently used bundle generation', async () => {
            // Only a handful of generations are retained; the fifth publication
            // pushes the first back out of the cache.
            const service = makeSubject(makeDefaultSpec(), {
                serviceOptions: { useTemplateCache: true },
            }).service;

            for (let i = 1; i <= 5; i += 1) {
                await renderWithSnapshot(service, makeContentSnapshot({
                    ...makeDefaultSpec(),
                    globalPartialsHash: `global-partials-hash-${ i }`,
                }));
            }

            const first = makeContentSnapshot(makeDefaultSpec());
            await renderWithSnapshot(service, first);

            assertEqual(1, first.callsTo('getGlobalTemplatePartials').length);
        });
    });

    describe('renderPage() malformed bundles', ({ it }) => {

        it('names the pathname when the global partial bundle is not an Array', async () => {
            const spec = makeDefaultSpec();
            spec.globalPartials = { byline: '<p>Nope</p>' };

            const caught = await catchAsyncError(() => {
                return renderSpec(spec);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('/templates/partials.json', caught.message);
        });

        it('names the pathname when the base template bundle is not an Array', async () => {
            const spec = makeDefaultSpec();
            spec.baseTemplates = { main: '<html></html>' };

            const caught = await catchAsyncError(() => {
                return renderSpec(spec);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('/templates/base-templates.json', caught.message);
        });

        it('names the pathname when the page partial bundle is not an Array', async () => {
            const spec = makeDefaultSpec();
            spec.pages['/'].partials = { byline: '<p>Nope</p>' };

            const caught = await catchAsyncError(() => {
                return renderSpec(spec);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('partials.json', caught.message);
        });
    });

    describe('renderEmail()', ({ it }) => {

        function makeEmailSpec() {
            return {
                globalPartials: [
                    { id: 'footer', source: '<footer>Example</footer>' },
                ],
                emails: {
                    '/welcome': {
                        bundle: {
                            contextData: { subject: 'Welcome', product: 'Kixx' },
                            htmlTemplate: { id: 'welcome.html', source: '<p>Hello {{ name }}{{> footer }}</p>' },
                            textTemplate: { id: 'welcome.txt', source: 'Hello {{ name }}' },
                        },
                    },
                },
            };
        }

        it('renders the subject, HTML body, and text body', async () => {
            const { service } = makeSubject(makeEmailSpec());

            const email = await service.renderEmail(CONTEXT, '/welcome', { name: 'Rakim' });

            assertEqual('Welcome', email.subject);
            assertEqual('<p>Hello Rakim<footer>Example</footer></p>', email.html);
            assertEqual('Hello Rakim', email.text);
        });

        it('passes the request context to every content read', async () => {
            const { service, snapshot } = makeSubject(makeEmailSpec());

            await service.renderEmail(CONTEXT, '/welcome', {});

            assert(snapshot.calls.length > 0, 'expected content reads');

            for (const call of snapshot.calls) {
                assertEqual(CONTEXT, call.context, `${ call.method } received the context`);
            }
        });

        it('throws NotFoundError when no bundle is published at the pathname', async () => {
            const { service } = makeSubject(makeEmailSpec());

            const caught = await catchAsyncError(() => {
                return service.renderEmail(CONTEXT, '/missing', {});
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
            assertMatches('/missing', caught.message);
        });

        it('resolves null for an unpublished representation', async () => {
            const spec = makeEmailSpec();
            delete spec.emails['/welcome'].bundle.textTemplate;

            const { service } = makeSubject(spec);

            const email = await service.renderEmail(CONTEXT, '/welcome', { name: 'Rakim' });

            assertEqual(null, email.text);
            assertMatches('Hello Rakim', email.html);
        });

        it('renders a templated subject against the merged context', async () => {
            const spec = makeEmailSpec();
            spec.emails['/welcome'].bundle.contextData.subject = {
                template: 'Welcome to {{ product }}, {{ name }}',
            };

            const { service } = makeSubject(spec);

            const email = await service.renderEmail(CONTEXT, '/welcome', { name: 'Rakim' });

            assertEqual('Welcome to Kixx, Rakim', email.subject);
        });

        it('lets caller props override published context data', async () => {
            const spec = makeEmailSpec();
            spec.emails['/welcome'].bundle.htmlTemplate.source = '<p>{{ product }}</p>';

            const { service } = makeSubject(spec);

            const email = await service.renderEmail(CONTEXT, '/welcome', { product: 'Overridden' });

            assertEqual('<p>Overridden</p>', email.html);
        });

        it('layers the bundle partials over the global partials', async () => {
            const spec = makeEmailSpec();
            spec.emails['/welcome'].bundle.partials = [
                { id: 'footer', source: '<footer>Bundle</footer>' },
            ];

            const { service } = makeSubject(spec);

            const email = await service.renderEmail(CONTEXT, '/welcome', { name: 'Rakim' });

            assertMatches('<footer>Bundle</footer>', email.html);
        });

        it('exposes the bundle includes to the templates', async () => {
            const spec = makeEmailSpec();
            spec.emails['/welcome'].bundle.includes = { signoff: 'Thanks.' };
            spec.emails['/welcome'].bundle.htmlTemplate.source = '<p>{{ includes.signoff }}</p>';

            const { service } = makeSubject(spec);

            const email = await service.renderEmail(CONTEXT, '/welcome', {});

            assertEqual('<p>Thanks.</p>', email.html);
        });

        it('does not leak one render\'s props into the next', async () => {
            // The bundle context data is mutated by the merge, so it has to be
            // parsed fresh on every call.
            const spec = makeEmailSpec();
            spec.emails['/welcome'].bundle.htmlTemplate.source = '<p>[{{ name }}]</p>';

            const { service } = makeSubject(spec);

            await service.renderEmail(CONTEXT, '/welcome', { name: 'Rakim' });
            const second = await service.renderEmail(CONTEXT, '/welcome', {});

            assertEqual('<p>[]</p>', second.html);
        });

        it('reads nothing from the page cache', async () => {
            const { service, kvStore } = makeSubject(makeEmailSpec(), {
                serviceOptions: { usePageCache: true },
            });

            await service.renderEmail(CONTEXT, '/welcome', {});

            assertEqual(0, kvStore.gets.length);
            assertEqual(0, kvStore.puts.length);
        });
    });

    describe('createMiniTemplate()', ({ it }) => {

        it('compiles and renders template source against a context', () => {
            const { service } = makeSubject(makeDefaultSpec());

            const template = service.createMiniTemplate('test.title', 'Hello {{ name }}');

            assertEqual('Hello Rakim', template({ name: 'Rakim' }));
        });

        it('makes the custom helpers available', () => {
            const { service } = makeSubject(makeDefaultSpec());

            const template = service.createMiniTemplate('test.title', '{{ truncate name 4 "..." }}');

            assertEqual('Eric...', template({ name: 'Eric B. & Rakim' }));
        });

        it('never expands a partial', () => {
            // The empty partial lookup means a partial tag in metadata resolves
            // nothing. Per the Mustache spec a missing partial renders as an empty
            // string, so this is silent rather than an error.
            const { service } = makeSubject(makeDefaultSpec());

            const template = service.createMiniTemplate('test.title', 'Hello [{{> byline }}]');

            assertEqual('Hello []', template({}));
        });
    });

    describe('initialize()', ({ it }) => {

        it('requires a kvStore', () => {
            const service = new HyperviewService({ logger: makeLogger() });

            let caught = null;
            try {
                service.initialize({ contentAddressableStore: {} });
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('kvStore', caught.message);
        });

        it('requires a contentAddressableStore', () => {
            const service = new HyperviewService({ logger: makeLogger() });

            let caught = null;
            try {
                service.initialize({ kvStore: {} });
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('contentAddressableStore', caught.message);
        });
    });
});


// Renders the default page once and returns the fixture, for tests which assert
// on what the render did rather than on what it produced.
async function renderDefaultPage(args) {
    const subject = makeSubject(makeDefaultSpec());

    await renderPageToResponse(subject.service,
        CONTEXT,
        makeRequest(args?.href),
        new ServerResponse(),
        makeFullPageOptions(),
    );

    return subject;
}

async function renderPageToResponse(service, context, request, response, options) {
    const result = await service.renderPage(context, {
        ...options,
        props: response.props,
        url: request.url,
    });

    if (result.type === 'hypertext') {
        return response.respondWithUtf8(response.status, result.hypertext);
    }

    return response.respondWithJSON(response.status, result.pageContext, { whiteSpace: 4 });
}

async function renderSpec(spec) {
    const { service } = makeSubject(spec);

    return await renderPageToResponse(service,
        CONTEXT,
        makeRequest(),
        new ServerResponse(),
        makeFullPageOptions(),
    );
}

async function renderTwice(service) {
    await renderPageToResponse(service,
        CONTEXT,
        makeRequest(),
        new ServerResponse(),
        makeFullPageOptions(),
    );
    await renderPageToResponse(service,
        CONTEXT,
        makeRequest(),
        new ServerResponse(),
        makeFullPageOptions(),
    );
}

// Drives one render against a specific snapshot, standing in for a request
// which resolved that publication.
async function renderWithSnapshot(service, snapshot) {
    const contentAddressableStore = makeContentAddressableStore(snapshot);

    service.initialize({
        contentAddressableStore,
        kvStore: makeKvStore(),
    });

    await renderPageToResponse(service,
        CONTEXT,
        makeRequest(),
        new ServerResponse(),
        makeFullPageOptions(),
    );
}
