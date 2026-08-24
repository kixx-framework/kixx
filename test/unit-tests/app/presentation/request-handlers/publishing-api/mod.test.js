import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    statStaticAsset,
    statGlobalTemplatePartials,
    putStaticAsset,
    putGlobalTemplatePartials,
    putBaseTemplates,
    putPageIncludes,
    putPagePartials,
    putPageTemplate,
    putEmailAssets,
    commitChanges,
} from '../../../../../../src/app/presentation/request-handlers/publishing-api/mod.js';

import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';


function makeContext(store) {
    return {
        getService(name) {
            assertEqual('ContentAddressableStore', name);
            return store;
        },
    };
}

function makeStore(content, options) {
    const tracker = new MockTracker();
    const { commitChangesResult } = options ?? {};

    const store = {
        normalizePathname: tracker.fn((pathname) => pathname),
        openSnapshot: tracker.fn(() => Promise.resolve(content)),
        commitChanges: tracker.fn(() => Promise.resolve(commitChangesResult)),
    };

    return { store, tracker };
}

function makeContentSnapshot(methods) {
    const tracker = new MockTracker();
    const content = {};

    for (const [ name, implementation ] of Object.entries(methods)) {
        content[name] = tracker.fn(implementation);
    }

    return { content, tracker };
}

function totalCallCount(content) {
    return Object.values(content).reduce((sum, fn) => sum + fn.mock.callCount(), 0);
}

function makeRequest(options) {
    const {
        pathname = '/publishing-api/v1',
        pathnameParams = {},
        contentMediaType = JSON_API_CONTENT_TYPE,
        jsonBody,
        textBody,
        arrayBufferBody,
    } = options ?? {};

    return {
        url: { pathname },
        pathnameParams,
        getContentMediaType() {
            return contentMediaType;
        },
        json() {
            return Promise.resolve(jsonBody);
        },
        text() {
            return Promise.resolve(textBody);
        },
        arrayBuffer() {
            return Promise.resolve(arrayBufferBody);
        },
    };
}

function makeResponse() {
    return new ServerResponse();
}

function jsonApiDocument(type, attributes, id) {
    return { data: { type, id, attributes } };
}

function parseBody(response) {
    return JSON.parse(response.body).data;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertError(error, name, code) {
    assert(error, 'expected an error to be thrown');
    assertEqual(name, error.name);
    assertEqual(code, error.code);
}


describe('publishing-api/mod', ({ describe }) => {

    describe('stat handlers with a pathname', ({ it }) => {
        it('builds the pathname from route path segments and responds with the stats resource', async () => {
            const { content } = makeContentSnapshot({
                statStaticAsset: (pathname) => {
                    assertEqual('css/site.css', pathname);
                    return { hash: 'asset-hash', size: 42, metadata: { contentType: 'text/css' } };
                },
            });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathname: '/publishing-api/v1/index/static-asset/css/site.css',
                pathnameParams: { path: [ 'css', 'site.css' ] },
            });

            const response = await statStaticAsset(makeContext(store), request, makeResponse());

            assertEqual(200, response.status);
            const data = parseBody(response);
            assertEqual('StaticAsset', data.type);
            assertEqual('asset-hash', data.id);
            assertEqual('css/site.css', data.attributes.pathname);
            assertEqual(42, data.attributes.size);
        });

        it('normalizes a missing path param to the root pathname', async () => {
            const { content } = makeContentSnapshot({
                statStaticAsset: (pathname) => {
                    assertEqual('', pathname);
                    return { hash: 'root-hash', size: 1 };
                },
            });
            const { store } = makeStore(content);

            const request = makeRequest({ pathnameParams: {} });

            const response = await statStaticAsset(makeContext(store), request, makeResponse());
            assertEqual(200, response.status);
        });

        it('throws NotFoundError when the store has no stats', async () => {
            const { content } = makeContentSnapshot({ statStaticAsset: () => null });
            const { store } = makeStore(content);

            const request = makeRequest({ pathnameParams: { path: [ 'missing.css' ] } });

            const error = await catchAsyncError(() => statStaticAsset(makeContext(store), request, makeResponse()));
            assertError(error, 'NotFoundError', 'NOT_FOUND_ERROR');
        });
    });

    describe('stat handlers without a pathname', ({ it }) => {
        it('responds with the stats resource without reading pathname params', async () => {
            const { content } = makeContentSnapshot({
                statGlobalTemplatePartials: () => ({ hash: 'bundle-hash', size: 7, metadata: {} }),
            });
            const { store } = makeStore(content);

            const response = await statGlobalTemplatePartials(makeContext(store), makeRequest(), makeResponse());

            assertEqual(200, response.status);
            const data = parseBody(response);
            assertEqual('GlobalTemplatePartials', data.type);
            assertEqual('bundle-hash', data.id);
        });

        it('throws NotFoundError when the store has no stats', async () => {
            const { content } = makeContentSnapshot({ statGlobalTemplatePartials: () => null });
            const { store } = makeStore(content);

            const error = await catchAsyncError(() => statGlobalTemplatePartials(makeContext(store), makeRequest(), makeResponse()));
            assertError(error, 'NotFoundError', 'NOT_FOUND_ERROR');
        });
    });

    describe('putStaticAsset', ({ it }) => {
        it('rejects an empty payload before writing to the store', async () => {
            const { content } = makeContentSnapshot({ putStaticAsset: () => ({ hash: 'x', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'css', 'site.css' ] },
                arrayBufferBody: new ArrayBuffer(0),
            });

            const error = await catchAsyncError(() => putStaticAsset(makeContext(store), request, makeResponse()));

            assertError(error, 'BadRequestError', 'BAD_REQUEST_ERROR');
            assertEqual(0, totalCallCount(content));
        });

        it('stores a non-empty payload and responds 201', async () => {
            const { content } = makeContentSnapshot({
                putStaticAsset: (_context, pathname, payload) => {
                    assertEqual('css/site.css', pathname);
                    assertEqual(4, payload.byteLength);
                    return { hash: 'asset-hash', size: payload.byteLength };
                },
            });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'css', 'site.css' ] },
                arrayBufferBody: new ArrayBuffer(4),
            });

            const response = await putStaticAsset(makeContext(store), request, makeResponse());

            assertEqual(201, response.status);
            const data = parseBody(response);
            assertEqual('asset-hash', data.id);
            assertEqual('css/site.css', data.attributes.pathname);
        });
    });

    describe('putPageTemplate', ({ it }) => {
        it('rejects a Content-Type other than text/plain', async () => {
            const { content } = makeContentSnapshot({ putPageTemplate: () => ({ hash: 'x', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'about' ] },
                contentMediaType: 'text/html',
            });

            const error = await catchAsyncError(() => putPageTemplate(makeContext(store), request, makeResponse()));

            assertError(error, 'UnsupportedMediaTypeError', 'UNSUPPORTED_MEDIA_TYPE_ERROR');
            assertEqual(0, totalCallCount(content));
        });

        it('stores the request text body when Content-Type is text/plain', async () => {
            const { content } = makeContentSnapshot({
                putPageTemplate: (_context, pathname, payload) => {
                    assertEqual('about', pathname);
                    assertEqual('<h1>{{title}}</h1>', payload);
                    return { hash: 'template-hash', size: payload.length };
                },
            });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'about' ] },
                contentMediaType: 'text/plain',
                textBody: '<h1>{{title}}</h1>',
            });

            const response = await putPageTemplate(makeContext(store), request, makeResponse());

            assertEqual(201, response.status);
            assertEqual('template-hash', parseBody(response).id);
        });
    });

    describe('bundle validation shared by putGlobalTemplatePartials, putBaseTemplates, and putPagePartials', ({ it }) => {
        const cases = [
            { handler: putGlobalTemplatePartials, type: 'GlobalTemplatePartials', storeMethod: 'putGlobalTemplatePartials', pathnameParams: {} },
            { handler: putBaseTemplates, type: 'BaseTemplates', storeMethod: 'putBaseTemplates', pathnameParams: {} },
            { handler: putPagePartials, type: 'PagePartials', storeMethod: 'putPagePartials', pathnameParams: { path: [ 'about' ] } },
        ];

        it('rejects a non-Array bundle', async () => {
            for (const { handler, type, storeMethod, pathnameParams } of cases) {
                const { content } = makeContentSnapshot({ [storeMethod]: () => ({ hash: 'x', size: 0 }) });
                const { store } = makeStore(content);

                const request = makeRequest({
                    pathnameParams,
                    jsonBody: jsonApiDocument(type, { bundle: 'not-an-array' }),
                });

                const error = await catchAsyncError(() => handler(makeContext(store), request, makeResponse()));

                assertError(error, 'ValidationError', 'VALIDATION_ERROR');
                assertEqual(0, totalCallCount(content));
            }
        });

        it('rejects bundle entries missing an id or source', async () => {
            for (const { handler, type, storeMethod, pathnameParams } of cases) {
                const { content } = makeContentSnapshot({ [storeMethod]: () => ({ hash: 'x', size: 0 }) });
                const { store } = makeStore(content);

                const request = makeRequest({
                    pathnameParams,
                    jsonBody: jsonApiDocument(type, { bundle: [ { id: '', source: 'body' }, { id: 'header' } ] }),
                });

                const error = await catchAsyncError(() => handler(makeContext(store), request, makeResponse()));

                assertError(error, 'ValidationError', 'VALIDATION_ERROR');
                assertEqual(2, error.errors.length);
                assertEqual(0, totalCallCount(content));
            }
        });

        it('stores a well-formed bundle and responds 201', async () => {
            for (const { handler, type, storeMethod, pathnameParams } of cases) {
                const { content } = makeContentSnapshot({
                    [storeMethod]: (_context, ...rest) => {
                        const templates = rest[rest.length - 1];
                        assertEqual(1, templates.length);
                        return { hash: 'bundle-hash', size: 1 };
                    },
                });
                const { store } = makeStore(content);

                const request = makeRequest({
                    pathnameParams,
                    jsonBody: jsonApiDocument(type, { bundle: [ { id: 'header', source: '<nav></nav>' } ] }),
                });

                const response = await handler(makeContext(store), request, makeResponse());

                assertEqual(201, response.status);
                assertEqual('bundle-hash', parseBody(response).id);
            }
        });
    });

    describe('putPageIncludes', ({ it }) => {
        it('rejects a bundle that is not a plain Object', async () => {
            const { content } = makeContentSnapshot({ putPageIncludes: () => ({ hash: 'x', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'about' ] },
                jsonBody: jsonApiDocument('PageIncludes', { bundle: [ 'not-an-object' ] }),
            });

            const error = await catchAsyncError(() => putPageIncludes(makeContext(store), request, makeResponse()));

            assertError(error, 'ValidationError', 'VALIDATION_ERROR');
            assertEqual(0, totalCallCount(content));
        });

        it('rejects non-string include values', async () => {
            const { content } = makeContentSnapshot({ putPageIncludes: () => ({ hash: 'x', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'about' ] },
                jsonBody: jsonApiDocument('PageIncludes', { bundle: { header: 42 } }),
            });

            const error = await catchAsyncError(() => putPageIncludes(makeContext(store), request, makeResponse()));

            assertError(error, 'ValidationError', 'VALIDATION_ERROR');
            assertEqual(0, totalCallCount(content));
        });

        it('stores a well-formed includes bundle', async () => {
            const { content } = makeContentSnapshot({
                putPageIncludes: (_context, _pathname, includes) => {
                    assertEqual('<footer></footer>', includes.footer);
                    return { hash: 'includes-hash', size: 1 };
                },
            });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'about' ] },
                jsonBody: jsonApiDocument('PageIncludes', { bundle: { footer: '<footer></footer>' } }),
            });

            const response = await putPageIncludes(makeContext(store), request, makeResponse());

            assertEqual(201, response.status);
        });
    });

    describe('putEmailAssets', ({ it }) => {
        it('accepts a bundle with no optional fields', async () => {
            const { content } = makeContentSnapshot({ putEmailAssets: () => ({ hash: 'email-hash', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'welcome' ] },
                jsonBody: jsonApiDocument('EmailAssets', {}),
            });

            const response = await putEmailAssets(makeContext(store), request, makeResponse());
            assertEqual(201, response.status);
        });

        it('rejects an htmlTemplate or textTemplate missing an id or source', async () => {
            const { content } = makeContentSnapshot({ putEmailAssets: () => ({ hash: 'x', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'welcome' ] },
                jsonBody: jsonApiDocument('EmailAssets', {
                    htmlTemplate: { id: 'html' },
                    textTemplate: { source: 'hi' },
                }),
            });

            const error = await catchAsyncError(() => putEmailAssets(makeContext(store), request, makeResponse()));

            assertError(error, 'ValidationError', 'VALIDATION_ERROR');
            assertEqual(2, error.errors.length);
            assertEqual(0, totalCallCount(content));
        });

        it('rejects malformed partials and includes', async () => {
            const { content } = makeContentSnapshot({ putEmailAssets: () => ({ hash: 'x', size: 0 }) });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'welcome' ] },
                jsonBody: jsonApiDocument('EmailAssets', {
                    partials: 'not-an-array',
                    includes: [ 'not-an-object' ],
                }),
            });

            const error = await catchAsyncError(() => putEmailAssets(makeContext(store), request, makeResponse()));

            assertError(error, 'ValidationError', 'VALIDATION_ERROR');
            assertEqual(2, error.errors.length);
            assertEqual(0, totalCallCount(content));
        });

        it('stores a fully-formed email bundle', async () => {
            const { content } = makeContentSnapshot({
                putEmailAssets: () => ({ hash: 'email-hash', size: 1 }),
            });
            const { store } = makeStore(content);

            const request = makeRequest({
                pathnameParams: { path: [ 'welcome' ] },
                jsonBody: jsonApiDocument('EmailAssets', {
                    htmlTemplate: { id: 'html', source: '<p>{{name}}</p>' },
                    textTemplate: { id: 'text', source: 'Hi {{name}}' },
                    partials: [ { id: 'footer', source: 'Bye' } ],
                    includes: { legal: 'Terms apply.' },
                    contextData: { name: 'Kris' },
                }),
            });

            const response = await putEmailAssets(makeContext(store), request, makeResponse());
            assertEqual(201, response.status);
        });
    });

    describe('commitChanges', ({ it }) => {
        it('commits the parsed content tree and responds with the resulting resource', async () => {
            const { store } = makeStore(null, { commitChangesResult: { hash: 'closure-hash', nodeCount: 12 } });

            const request = makeRequest({
                jsonBody: jsonApiDocument('ContentTree', { buildId: 'build-42', pages: { about: 'about-hash' } }),
            });

            const response = await commitChanges(makeContext(store), request, makeResponse());

            assertEqual(201, response.status);
            const data = parseBody(response);
            assertEqual('ContentTree', data.type);
            assertEqual('closure-hash', data.id);
            assertEqual('build-42', data.attributes.buildId);
            assertEqual(12, data.attributes.nodeCount);

            const call = store.commitChanges.mock.getCall(0);
            assertEqual('build-42', call.arguments[1]);
            assertEqual('about-hash', call.arguments[2].pages.about);
        });
    });
});
