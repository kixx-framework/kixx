import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import HyperviewRequestHandler from '../../../src/kixx/hyperview/hyperview-request-handler.js';
import ServerResponse from '../../../src/kixx/http-router/server-response.js';


function makeService(options) {
    const {
        pageData = { page: {} },
        baseTemplate = (data) => `<html>${ data.body }</html>`,
        pageTemplate = () => '<p>page</p>',
        calls,
    } = options ?? {};

    return {
        async getPageData(_context, url, pathname, props, opts) {
            if (calls) {
                calls.getPageData = { url, pathname, props, opts };
            }
            return pageData;
        },
        async getBaseTemplate(_context, templateId, opts) {
            if (calls) {
                calls.getBaseTemplate = { templateId, opts };
            }
            return baseTemplate;
        },
        async getPageTemplate(_context, pathname, templateId, opts) {
            if (calls) {
                calls.getPageTemplate = { pathname, templateId, opts };
            }
            return pageTemplate;
        },
    };
}

function makeContext(options) {
    const { service, env = {} } = options ?? {};

    return {
        getEnvBoolean(key) {
            return Boolean(env[key]);
        },
        getService() {
            return service ?? makeService();
        },
    };
}

function makeRequest(options) {
    const { url = new URL('https://example.com/'), isJSON = false } = options ?? {};

    return {
        url,
        isJSONRequest: () => isJSON,
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('HyperviewRequestHandler', ({ describe }) => {

    describe('pathname resolution', ({ it }) => {
        it('derives the pathname from the URL pathname', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest({ url: new URL('https://example.com/blog/post') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual('/blog/post', calls.getPageData.pathname);
        });

        it('strips index files from the pathname', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest({ url: new URL('https://example.com/blog/index.html') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual('/blog/', calls.getPageData.pathname);
        });

        it('strips the .json format extension from the last path segment', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest({ url: new URL('https://example.com/platform.json') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual('/platform', calls.getPageData.pathname);
        });

        it('uses options.pathname when provided, ignoring the URL', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest({ url: new URL('https://example.com/whatever') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', pathname: '/custom' });
            await handler(context, request, response);

            assertEqual('/custom', calls.getPageData.pathname);
        });

        it('uses a custom indexFilePattern option', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest({ url: new URL('https://example.com/blog/default.htm') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({
                baseTemplate: 'default.html',
                indexFilePattern: 'default\\.htm$',
            });
            await handler(context, request, response);

            assertEqual('/blog/', calls.getPageData.pathname);
        });

        it('uses a custom formatExtensionPattern option', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest({ url: new URL('https://example.com/feed.xml') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({
                baseTemplate: 'default.html',
                formatExtensionPattern: '\\.xml$',
            });
            await handler(context, request, response);

            assertEqual('/feed', calls.getPageData.pathname);
        });
    });

    describe('pathname validation', ({ it }) => {
        it('throws BadRequestError when the pathname contains ".."', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', pathname: '/foo/../bar' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });

        it('throws BadRequestError when the pathname contains "//"', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', pathname: '/foo//bar' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });

        it('throws BadRequestError when a path segment starts with "."', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', pathname: '/.hidden' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });

        it('throws BadRequestError when the pathname contains disallowed characters', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', pathname: '/foo bar' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });
    });

    describe('JSON responses', ({ it }) => {
        it('returns JSON when allowJSON is true and the request is a JSON request', async () => {
            const pageData = { page: { title: 'Hi' } };
            const context = makeContext({ service: makeService({ pageData }) });
            const request = makeRequest({ isJSON: true });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', allowJSON: true });
            const result = await handler(context, request, response);

            assertEqual(200, result.status);
            assertMatches('application/json', result.headers.get('content-type'));
            assertMatches('"title": "Hi"', result.body);
        });

        it('does not return JSON when allowJSON is false even for a JSON request', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest({ isJSON: true });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', allowJSON: false });
            const result = await handler(context, request, response);

            assertMatches('text/html', result.headers.get('content-type'));
        });

        it('does not return JSON when the request is not a JSON request', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest({ isJSON: false });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', allowJSON: true });
            const result = await handler(context, request, response);

            assertMatches('text/html', result.headers.get('content-type'));
        });

        it('falls back to the HYPERVIEW_ALLOW_JSON_RESPONSE env var when the option is not set', async () => {
            const context = makeContext({
                service: makeService(),
                env: { HYPERVIEW_ALLOW_JSON_RESPONSE: true },
            });
            const request = makeRequest({ isJSON: true });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            const result = await handler(context, request, response);

            assertMatches('application/json', result.headers.get('content-type'));
        });
    });

    describe('useCache option', ({ it }) => {
        it('passes useCache:true to the service when the option is set', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', useCache: true });
            await handler(context, request, response);

            assertEqual(true, calls.getPageData.opts.useCache);
        });

        it('falls back to the HYPERVIEW_USE_CACHE env var when the option is not set', async () => {
            const calls = {};
            const context = makeContext({
                service: makeService({ calls }),
                env: { HYPERVIEW_USE_CACHE: true },
            });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual(true, calls.getPageData.opts.useCache);
        });
    });

    describe('page data', ({ it }) => {
        it('throws NotFoundError when no page data is found', async () => {
            const context = makeContext({ service: makeService({ pageData: null }) });
            const request = makeRequest({ url: new URL('https://example.com/missing') });
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
            assertMatches('/missing', caught.message);
        });

        it('passes response.props as props by default', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest();
            const response = new ServerResponse();
            response.updateProps({ greeting: 'hello' });

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual(response.props, calls.getPageData.props);
        });

        it('passes null as props when isStatic is true', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest();
            const response = new ServerResponse();
            response.updateProps({ greeting: 'hello' });

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html', isStatic: true });
            await handler(context, request, response);

            assertEqual(null, calls.getPageData.props);
        });
    });

    describe('baseTemplate resolution', ({ it }) => {
        it('uses options.baseTemplate when pageData.baseTemplate is not set', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual('default.html', calls.getBaseTemplate.templateId);
        });

        it('uses pageData.baseTemplate to override options.baseTemplate', async () => {
            const calls = {};
            const pageData = { page: {}, baseTemplate: 'custom.html' };
            const context = makeContext({ service: makeService({ calls, pageData }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual('custom.html', calls.getBaseTemplate.templateId);
        });

        it('throws AssertionError when no baseTemplate is provided by options or page data', async () => {
            const context = makeContext({ service: makeService() });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler();
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('A baseTemplate ID must be provided', caught.message);
        });

        it('throws AssertionError when the base template is not found', async () => {
            const context = makeContext({ service: makeService({ baseTemplate: null }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'missing.html' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('The base template was not found', caught.message);
        });
    });

    describe('pageTemplate resolution', ({ it }) => {
        it('defaults to page.html', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            await handler(context, request, response);

            assertEqual('page.html', calls.getPageTemplate.templateId);
        });

        it('uses options.pageTemplate when set', async () => {
            const calls = {};
            const context = makeContext({ service: makeService({ calls }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({
                baseTemplate: 'default.html',
                pageTemplate: 'custom-page.html',
            });
            await handler(context, request, response);

            assertEqual('custom-page.html', calls.getPageTemplate.templateId);
        });

        it('uses pageData.pageTemplate to override options.pageTemplate', async () => {
            const calls = {};
            const pageData = { page: {}, pageTemplate: 'special.html' };
            const context = makeContext({ service: makeService({ calls, pageData }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({
                baseTemplate: 'default.html',
                pageTemplate: 'custom-page.html',
            });
            await handler(context, request, response);

            assertEqual('special.html', calls.getPageTemplate.templateId);
        });

        it('throws AssertionError when the page template is not found', async () => {
            const context = makeContext({ service: makeService({ pageTemplate: null }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            const caught = await catchAsyncError(() => handler(context, request, response));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('The page template was not found', caught.message);
        });
    });

    describe('rendering', ({ it }) => {
        it('renders the page template into pageData.body and the result into the base template', async () => {
            const pageData = { page: { title: 'Hello' } };
            const baseTemplate = (data) => `<html>${ data.body }</html>`;
            const pageTemplate = (data) => `<p>${ data.page.title }</p>`;
            const context = makeContext({ service: makeService({ pageData, baseTemplate, pageTemplate }) });
            const request = makeRequest();
            const response = new ServerResponse();

            const handler = HyperviewRequestHandler({ baseTemplate: 'default.html' });
            const result = await handler(context, request, response);

            assertEqual('<html><p>Hello</p></html>', result.body);
            assertMatches('text/html', result.headers.get('content-type'));
        });
    });
});
