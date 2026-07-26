import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    HyperviewStaticPageHandler,
    HyperviewDynamicPageHandler,
} from '../../../../src/kixx/hyperview/hyperview-request-handlers.js';

import ServerResponse from '../../../../src/kixx/http-router/server-response.js';


// The handlers only interact with the Hyperview service through this small set
// of methods, so the double implements exactly those. Each method is a tracked
// mock, which lets tests assert both the rendering result and the calls made to
// resolve it (page cache reads, template cache flags, include resolution).
function makeService(overrides) {
    const tracker = new MockTracker();

    const service = {
        getPageMetadata: tracker.fn(() => {
            return Promise.resolve({
                version: 'version-1',
                metadata: { page: { title: 'Page Title' } },
            });
        }),
        getCachedPage: tracker.fn(() => Promise.resolve(null)),
        setCachedPage: tracker.fn(() => Promise.resolve()),
        mergePageMetadata: tracker.fn((url, metadata) => {
            return Object.assign({ canonicalURL: url.href }, metadata.page);
        }),
        getBaseTemplate: tracker.fn(() => {
            return Promise.resolve((metadata) => {
                return `<html>${ metadata.body || '' }</html>`;
            });
        }),
        getPageTemplate: tracker.fn(() => {
            return Promise.resolve((metadata) => {
                return `<main>${ metadata.page.title }</main>`;
            });
        }),
        getIncludes: tracker.fn(() => Promise.resolve({ body: { html: '<p>included</p>' } })),
    };

    return Object.assign(service, overrides);
}

function makeContext(service, hyperviewConfig) {
    return {
        config: { env: { HYPERVIEW: hyperviewConfig } },
        getService(name) {
            assertEqual('Hyperview', name);
            return service;
        },
    };
}

function makeRequest(pathname, options) {
    const { isJSON } = options || {};

    return {
        url: new URL(pathname, 'https://www.example.com'),
        isJSONRequest() {
            return Boolean(isJSON);
        },
    };
}

function makeResponse(props) {
    const response = new ServerResponse();
    if (props) {
        response.updateProps(props);
    }
    return response;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Hyperview request handlers', ({ describe }) => {

    describe('HyperviewStaticPageHandler', ({ describe }) => {

        describeSharedPageHandlerBehavior(describe, {
            createHandler: HyperviewStaticPageHandler,
            handlerName: 'HyperviewStaticPageHandler',
        });

        describe('page cache', ({ it }) => {
            it('returns the cached page without rendering templates', async () => {
                const service = makeService({
                    getCachedPage: () => Promise.resolve('<html>cached</html>'),
                });
                const handler = HyperviewStaticPageHandler({
                    usePageCache: true,
                    baseTemplate: 'base.html',
                });

                const response = await handler(
                    makeContext(service),
                    makeRequest('/platform'),
                    makeResponse(),
                );

                assertEqual('<html>cached</html>', response.body);
                assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
                assertEqual(0, service.getBaseTemplate.mock.callCount());
                assertEqual(0, service.getPageTemplate.mock.callCount());
            });

            it('looks up the cached page by pathname and page version', async () => {
                const service = makeService();
                const handler = HyperviewStaticPageHandler({
                    usePageCache: true,
                    baseTemplate: 'base.html',
                });

                await handler(makeContext(service), makeRequest('/platform'), makeResponse());

                const args = service.getCachedPage.mock.getCall(0).arguments;
                assertEqual('/platform', args[1]);
                assertEqual('version-1', args[2]);
            });

            it('caches the rendered page after a cache miss', async () => {
                const service = makeService();
                const handler = HyperviewStaticPageHandler({
                    usePageCache: true,
                    baseTemplate: 'base.html',
                });

                const response = await handler(
                    makeContext(service),
                    makeRequest('/platform'),
                    makeResponse(),
                );

                assertEqual(1, service.setCachedPage.mock.callCount());

                const args = service.setCachedPage.mock.getCall(0).arguments;
                assertEqual('/platform', args[1]);
                assertEqual('version-1', args[2]);
                assertEqual(response.body, args[3]);
            });

            it('does not touch the page cache when the page cache is disabled', async () => {
                const service = makeService();
                const handler = HyperviewStaticPageHandler({
                    usePageCache: false,
                    baseTemplate: 'base.html',
                });

                await handler(makeContext(service), makeRequest('/platform'), makeResponse());

                assertEqual(0, service.getCachedPage.mock.callCount());
                assertEqual(0, service.setCachedPage.mock.callCount());
            });

            it('falls back to the USE_PAGE_CACHE config setting', async () => {
                const service = makeService();
                const handler = HyperviewStaticPageHandler({ baseTemplate: 'base.html' });

                await handler(
                    makeContext(service, { USE_PAGE_CACHE: true }),
                    makeRequest('/platform'),
                    makeResponse(),
                );

                assertEqual(1, service.getCachedPage.mock.callCount());
                assertEqual(1, service.setCachedPage.mock.callCount());
            });

            it('does not use the page cache for allowed JSON requests', async () => {
                const service = makeService();
                const handler = HyperviewStaticPageHandler({
                    usePageCache: true,
                    allowJSON: true,
                    baseTemplate: 'base.html',
                });

                const response = await handler(
                    makeContext(service),
                    makeRequest('/platform', { isJSON: true }),
                    makeResponse(),
                );

                assertEqual('application/json; charset=utf-8', response.headers.get('content-type'));
                assertEqual(0, service.getCachedPage.mock.callCount());
                assertEqual(0, service.setCachedPage.mock.callCount());
            });

            it('uses the page cache for JSON requests when JSON responses are disallowed', async () => {
                const service = makeService();
                const handler = HyperviewStaticPageHandler({
                    usePageCache: true,
                    allowJSON: false,
                    baseTemplate: 'base.html',
                });

                const response = await handler(
                    makeContext(service),
                    makeRequest('/platform', { isJSON: true }),
                    makeResponse(),
                );

                assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
                assertEqual(1, service.getCachedPage.mock.callCount());
                assertEqual(1, service.setCachedPage.mock.callCount());
            });
        });
    });

    describe('HyperviewDynamicPageHandler', ({ describe }) => {

        describeSharedPageHandlerBehavior(describe, {
            createHandler: HyperviewDynamicPageHandler,
            handlerName: 'HyperviewDynamicPageHandler',
        });

        describe('page cache', ({ it }) => {
            it('never reads or writes the page cache, even when config enables it', async () => {
                const service = makeService();
                const handler = HyperviewDynamicPageHandler({ baseTemplate: 'base.html' });

                const response = await handler(
                    makeContext(service, { USE_PAGE_CACHE: true }),
                    makeRequest('/platform'),
                    makeResponse(),
                );

                assertEqual('<html><main>Page Title</main></html>', response.body);
                assertEqual(0, service.getCachedPage.mock.callCount());
                assertEqual(0, service.setCachedPage.mock.callCount());
            });
        });
    });
});


// Both handlers resolve the pathname, load page metadata, negotiate JSON, select
// templates, and render identically. The shared expectations are registered in
// each handler's suite so a divergence in either handler fails on its own.
function describeSharedPageHandlerBehavior(describe, { createHandler, handlerName }) {

    describe('pathname resolution', ({ it }) => {
        it('lowercases the URL pathname', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/Platform/Docs'), makeResponse());

            assertEqual('/platform/docs', service.getPageMetadata.mock.getCall(0).arguments[1]);
        });

        it('strips a trailing index file from the pathname', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/docs/index.html'), makeResponse());

            assertEqual('/docs/', service.getPageMetadata.mock.getCall(0).arguments[1]);
        });

        it('strips the format extension used for content negotiation', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/platform.json'), makeResponse());

            assertEqual('/platform', service.getPageMetadata.mock.getCall(0).arguments[1]);
        });

        it('uses the pathname option instead of the request URL', async () => {
            const service = makeService();
            const handler = createHandler({
                pathname: '/Overridden/Page.html',
                baseTemplate: 'base.html',
            });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            // The option is lowercased, but index and format stripping do not apply to it.
            assertEqual('/overridden/page.html', service.getPageMetadata.mock.getCall(0).arguments[1]);
        });

        it('honors a custom index file pattern', async () => {
            const service = makeService();
            const handler = createHandler({
                indexFilePattern: '(?:^|/)default\\.html$',
                baseTemplate: 'base.html',
            });

            await handler(makeContext(service), makeRequest('/docs/default.html'), makeResponse());

            assertEqual('/docs/', service.getPageMetadata.mock.getCall(0).arguments[1]);
        });

        it('honors a custom format extension pattern', async () => {
            const service = makeService();
            const handler = createHandler({
                formatExtensionPattern: '\\.xml$',
                baseTemplate: 'base.html',
            });

            await handler(makeContext(service), makeRequest('/feed.xml'), makeResponse());

            assertEqual('/feed', service.getPageMetadata.mock.getCall(0).arguments[1]);
        });

        // A URL object normalizes `..` out of the pathname, so traversal can only
        // reach validation through the pathname option.
        it('rejects a pathname containing path traversal', async () => {
            const service = makeService();
            const handler = createHandler({
                pathname: '/docs/../secret',
                baseTemplate: 'base.html',
            });

            const caught = await catchAsyncError(() => {
                return handler(makeContext(service), makeRequest('/docs'), makeResponse());
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname', caught.message);
            assertEqual(0, service.getPageMetadata.mock.callCount());
        });

        it('rejects a pathname segment with a disallowed character', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            const caught = await catchAsyncError(() => {
                return handler(makeContext(service), makeRequest('/docs/page$1'), makeResponse());
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(0, service.getPageMetadata.mock.callCount());
        });
    });

    describe('page lookup', ({ it }) => {
        it('throws NotFoundError when the page has no metadata', async () => {
            const service = makeService({
                getPageMetadata: () => Promise.resolve(null),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            const caught = await catchAsyncError(() => {
                return handler(makeContext(service), makeRequest('/missing'), makeResponse());
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
            assertMatches('No page found for pathname "/missing"', caught.message);
        });
    });

    describe('rendering', ({ it }) => {
        it('renders the page template into the base template', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform'),
                makeResponse(),
            );

            assertEqual(200, response.status);
            assertEqual('<html><main>Page Title</main></html>', response.body);
            assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        });

        it('responds with the status already set on the response', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });
            const response = makeResponse();
            response.status = 404;

            await handler(makeContext(service), makeRequest('/platform'), response);

            assertEqual(404, response.status);
        });

        it('renders the base template alone when there is no page template', async () => {
            const service = makeService({
                getPageTemplate: () => Promise.resolve(null),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform'),
                makeResponse(),
            );

            assertEqual('<html></html>', response.body);
        });

        it('merges response props into the page metadata', async () => {
            const service = makeService({
                getPageTemplate: () => Promise.resolve((metadata) => {
                    return `<main>${ metadata.page.title }:${ metadata.user.name }</main>`;
                }),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform'),
                makeResponse({ user: { name: 'Kris' } }),
            );

            assertEqual('<html><main>Page Title:Kris</main></html>', response.body);
        });

        it('assigns the merged open graph metadata to the page property', async () => {
            const service = makeService({
                getPageTemplate: () => Promise.resolve((metadata) => {
                    return `<main>${ metadata.page.canonicalURL }</main>`;
                }),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            // The template renders a property only the merged page object carries,
            // so the body shows the merge result reached the template context.
            const response = await handler(
                makeContext(service),
                makeRequest('/platform'),
                makeResponse(),
            );

            const args = service.mergePageMetadata.mock.getCall(0).arguments;
            assertEqual('https://www.example.com/platform', args[0].href);
            assertEqual('Page Title', args[1].page.title);
            assertEqual('<html><main>https://www.example.com/platform</main></html>', response.body);
        });

        it('resolves includes declared by the page', async () => {
            const service = makeService({
                getPageMetadata: () => Promise.resolve({
                    version: 'version-1',
                    metadata: {
                        page: { title: 'Page Title' },
                        includes: { body: { filename: 'body.md' } },
                    },
                }),
                getPageTemplate: () => Promise.resolve((metadata) => {
                    return `<main>${ metadata.includes.body.html }</main>`;
                }),
            });
            const handler = createHandler({ baseTemplate: 'base.html', useTemplateCache: true });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform'),
                makeResponse(),
            );

            assertEqual('<html><main><p>included</p></main></html>', response.body);

            const args = service.getIncludes.mock.getCall(0).arguments;
            assertEqual('/platform', args[1]);
            assertEqual('body.md', args[2].body.filename);
            assertEqual(true, args[3].useCache);
            assertEqual('version-1', args[3].version);
        });

        it('does not resolve includes when the page declares none', async () => {
            const service = makeService({
                getPageMetadata: () => Promise.resolve({
                    version: 'version-1',
                    metadata: { page: { title: 'Page Title' }, includes: {} },
                }),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            assertEqual(0, service.getIncludes.mock.callCount());
        });
    });

    describe('template selection', ({ it }) => {
        it('defaults the page template ID to the page pathname', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/docs/index.html'), makeResponse());

            // The trailing slash left by index stripping is removed for the template ID.
            assertEqual('/docs/page.html', service.getPageTemplate.mock.getCall(0).arguments[1]);
        });

        it('uses the page template option when the page does not specify one', async () => {
            const service = makeService();
            const handler = createHandler({
                baseTemplate: 'base.html',
                pageTemplate: '/shared/page.html',
            });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            assertEqual('/shared/page.html', service.getPageTemplate.mock.getCall(0).arguments[1]);
        });

        it('prefers the page template declared in page metadata', async () => {
            const service = makeService({
                getPageMetadata: () => Promise.resolve({
                    version: 'version-1',
                    metadata: { page: { title: 'Page Title' }, pageTemplate: '/custom/page.html' },
                }),
            });
            const handler = createHandler({
                baseTemplate: 'base.html',
                pageTemplate: '/shared/page.html',
            });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            assertEqual('/custom/page.html', service.getPageTemplate.mock.getCall(0).arguments[1]);
        });

        it('prefers the base template declared in page metadata', async () => {
            const service = makeService({
                getPageMetadata: () => Promise.resolve({
                    version: 'version-1',
                    metadata: { page: { title: 'Page Title' }, baseTemplate: 'custom-base.html' },
                }),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            assertEqual('custom-base.html', service.getBaseTemplate.mock.getCall(0).arguments[1]);
        });

        it('throws AssertionError when no base template ID is available', async () => {
            const service = makeService();
            const handler = createHandler();

            const caught = await catchAsyncError(() => {
                return handler(makeContext(service), makeRequest('/platform'), makeResponse());
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches(handlerName, caught.message);
            assertMatches('pathname:/platform', caught.message);
        });

        it('throws AssertionError when the base template is not found', async () => {
            const service = makeService({
                getBaseTemplate: () => Promise.resolve(null),
            });
            const handler = createHandler({ baseTemplate: 'base.html' });

            const caught = await catchAsyncError(() => {
                return handler(makeContext(service), makeRequest('/platform'), makeResponse());
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('The base template was not found', caught.message);
            assertMatches('baseTemplate:base.html', caught.message);
        });
    });

    describe('JSON content negotiation', ({ it }) => {
        it('responds with JSON metadata when JSON is requested and allowed', async () => {
            const service = makeService();
            const handler = createHandler({ allowJSON: true, baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform.json', { isJSON: true }),
                makeResponse({ user: { name: 'Kris' } }),
            );

            assertEqual('application/json; charset=utf-8', response.headers.get('content-type'));

            const body = JSON.parse(response.body);
            assertEqual('Page Title', body.page.title);
            assertEqual('https://www.example.com/platform.json', body.page.canonicalURL);
            assertEqual('Kris', body.user.name);

            // Templates are never compiled for a JSON response.
            assertEqual(0, service.getBaseTemplate.mock.callCount());
            assertEqual(0, service.getPageTemplate.mock.callCount());
        });

        it('responds with HTML when JSON is requested but not allowed', async () => {
            const service = makeService();
            const handler = createHandler({ allowJSON: false, baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform.json', { isJSON: true }),
                makeResponse(),
            );

            assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        });

        it('responds with HTML when JSON is allowed but not requested', async () => {
            const service = makeService();
            const handler = createHandler({ allowJSON: true, baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service),
                makeRequest('/platform'),
                makeResponse(),
            );

            assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        });

        it('falls back to the ALLOW_JSON_RESPONSE config setting', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            const response = await handler(
                makeContext(service, { ALLOW_JSON_RESPONSE: true }),
                makeRequest('/platform.json', { isJSON: true }),
                makeResponse(),
            );

            assertEqual('application/json; charset=utf-8', response.headers.get('content-type'));
        });

        it('accepts the string and number config vocabulary for booleans', async () => {
            const stringConfigResponse = await respondToJSONRequestWithConfig(
                createHandler,
                { ALLOW_JSON_RESPONSE: 'true' },
            );
            assertEqual('application/json; charset=utf-8', stringConfigResponse.headers.get('content-type'));

            const numberConfigResponse = await respondToJSONRequestWithConfig(
                createHandler,
                { ALLOW_JSON_RESPONSE: 1 },
            );
            assertEqual('application/json; charset=utf-8', numberConfigResponse.headers.get('content-type'));

            const oneStringConfigResponse = await respondToJSONRequestWithConfig(
                createHandler,
                { ALLOW_JSON_RESPONSE: '1' },
            );
            assertEqual('application/json; charset=utf-8', oneStringConfigResponse.headers.get('content-type'));
        });

        it('treats other config values as false', async () => {
            const falseResponse = await respondToJSONRequestWithConfig(
                createHandler,
                { ALLOW_JSON_RESPONSE: 'yes' },
            );
            assertEqual('text/html; charset=utf-8', falseResponse.headers.get('content-type'));

            const missingSectionResponse = await respondToJSONRequestWithConfig(createHandler, null);
            assertEqual('text/html; charset=utf-8', missingSectionResponse.headers.get('content-type'));
        });
    });

    describe('template cache', ({ it }) => {
        it('passes the useTemplateCache option through to template lookups', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html', useTemplateCache: true });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            assertEqual(true, service.getBaseTemplate.mock.getCall(0).arguments[2].useCache);
            assertEqual(true, service.getPageTemplate.mock.getCall(0).arguments[2].useCache);
        });

        it('falls back to the USE_TEMPLATE_CACHE config setting', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(
                makeContext(service, { USE_TEMPLATE_CACHE: '1' }),
                makeRequest('/platform'),
                makeResponse(),
            );

            assertEqual(true, service.getBaseTemplate.mock.getCall(0).arguments[2].useCache);
        });

        it('defaults the template cache to false when there is no config', async () => {
            const service = makeService();
            const handler = createHandler({ baseTemplate: 'base.html' });

            await handler(makeContext(service), makeRequest('/platform'), makeResponse());

            assertEqual(false, service.getBaseTemplate.mock.getCall(0).arguments[2].useCache);
            assertEqual(false, service.getPageTemplate.mock.getCall(0).arguments[2].useCache);
        });
    });
}

// Exercises a handler with a JSON request against a specific HYPERVIEW config
// section. Used by the config vocabulary tests, which assert on several
// config values within one behavior.
function respondToJSONRequestWithConfig(createHandler, hyperviewConfig) {
    const handler = createHandler({ baseTemplate: 'base.html' });

    return handler(
        makeContext(makeService(), hyperviewConfig),
        makeRequest('/platform.json', { isJSON: true }),
        makeResponse(),
    );
}
