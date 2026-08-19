import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import HyperviewService from '../../../../src/kixx/hyperview/hyperview-service.js';


function makeLogger() {
    return {
        createChild() {
            return { debug() {} };
        },
    };
}

// A minimal page-and-store pair for cache-key tests. The hashValue() stub
// serializes objects so that two distinct props objects produce two distinct
// hashes, which is what makes a props-sensitive cache key observable.
function makePropsCacheKeyFixtures() {
    const pageContent = {
        pageTemplateFilename: 'page.html',
        partials: null,
        includes: null,
        etag: 'page-etag-1',
        pageDataFiles: [
            { json() {
                return { page: {} };
            } },
        ],
    };

    const store = {
        isValidPathname(value) {
            return typeof value === 'string' && value.length > 0;
        },
        normalizePathname(value) {
            return value;
        },
        async getPage() {
            return pageContent;
        },
        async statTemplatePartials() {
            return null;
        },
        async getTemplatePartials() {
            return null;
        },
        async hashValue(value) {
            if (typeof value === 'string') {
                return `hash:${ value }`;
            }
            return `hash:${ JSON.stringify(value) }`;
        },
        async statPageTemplate() {
            return null;
        },
        async getPageTemplate() {
            return {
                text() {
                    return 'PAGE BODY';
                },
                etag: 'page-template-etag-1',
            };
        },
    };

    return { pageContent, store };
}

// Simulates the content-addressable store's deterministic hashing capability:
// fixed-length output regardless of input size, so a mocked store behaves like
// the real one for tests that depend on the KV key being bounded and opaque.
function makeOpaqueHashValue() {
    return async function hashValue(value) {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) {
            hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
        }
        return `h${ (hash >>> 0).toString(16).padStart(8, '0') }`;
    };
}

// A KV-store double which enforces the real portable 512-byte UTF-8 key limit,
// so a test using it fails for the same reason the platform adapters would.
function makeSizeBoundedKvStore() {
    const KV_KEY_BYTE_LIMIT = 512;

    function assertKeyWithinLimit(key) {
        const byteLength = new TextEncoder().encode(key).length;
        assert(
            byteLength <= KV_KEY_BYTE_LIMIT,
            `KV key exceeds the portable ${ KV_KEY_BYTE_LIMIT }-byte limit (${ byteLength } bytes)`,
        );
    }

    return {
        async get(_context, key) {
            assertKeyWithinLimit(key);
            return null;
        },
        async put(_context, key) {
            assertKeyWithinLimit(key);
        },
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

describe('HyperviewService', ({ describe }) => {

    describe('getPagePartials', ({ it }) => {
        it('refreshes global partials when returning cached page partials', async () => {
            const globalPartials = {
                etag: 'global-v1',
                templates: [
                    { id: 'global.html', source: 'first global partial' },
                ],
            };
            const store = {
                async statTemplatePartials() {
                    return { etag: globalPartials.etag };
                },
                async getTemplatePartials() {
                    return {
                        etag: globalPartials.etag,
                        json() {
                            return globalPartials.templates;
                        },
                    };
                },
            };
            const service = new HyperviewService({
                logger: {
                    createChild() {
                        return {};
                    },
                },
                useTemplateCache: true,
            });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const page = {
                pathname: '/articles/example',
                partials: {
                    etag: 'page-v1',
                    partials: [
                        { id: 'page.html', source: '{{> global.html }}' },
                    ],
                },
            };

            const pagePartials = await service.getPagePartials({}, page);
            assertEqual('first global partial', pagePartials.get('page.html')({}));

            globalPartials.etag = 'global-v2';
            globalPartials.templates = [
                { id: 'global.html', source: 'second global partial' },
            ];

            const cachedPagePartials = await service.getPagePartials({}, page);

            assertEqual('second global partial', cachedPagePartials.get('page.html')({}));
        });

        it('returns a reusable empty Map for a page which declares no partials', async () => {
            // The Map instance must be retained across calls, because a compiled page
            // template delegates its partial lookups into this exact instance.
            const store = {
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const page = { pathname: '/articles/example', partials: null };

            const first = await service.getPagePartials({}, page);
            const second = await service.getPagePartials({}, page);

            assertEqual(0, first.size);
            assertEqual(null, first.etag);
            assert(first === second, 'expected the same Map instance across calls');
        });

        it('empties a cached partials Map when the page stops declaring partials', async () => {
            const store = {
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const page = {
                pathname: '/articles/example',
                partials: {
                    etag: 'page-v1',
                    partials: [
                        { id: 'page.html', source: 'PAGE PARTIAL' },
                    ],
                },
            };

            const populated = await service.getPagePartials({}, page);
            assertEqual(1, populated.size);

            page.partials = null;
            const emptied = await service.getPagePartials({}, page);

            assert(populated === emptied, 'expected the same Map instance to be reused');
            assertEqual(0, emptied.size);
            assertEqual(null, emptied.etag);
        });

        it('does not retain a partials Map when useTemplateCache is disabled', async () => {
            const store = {
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const page = { pathname: '/articles/example', partials: null };

            const first = await service.getPagePartials({}, page);
            const second = await service.getPagePartials({}, page);

            assertEqual(0, first.size);
            assert(first !== second, 'expected a fresh Map instance on each call');
        });
    });

    describe('loadGlobalPartials', ({ it }) => {
        it('skips the stat() call when useTemplateCache is disabled', async () => {
            let statCalls = 0;
            let getCalls = 0;
            const store = {
                async statTemplatePartials() {
                    statCalls += 1;
                    return { etag: 'global-v1' };
                },
                async getTemplatePartials() {
                    getCalls += 1;
                    return {
                        etag: 'global-v1',
                        json() {
                            return [ { id: 'global.html', source: 'hello' } ];
                        },
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const partials = await service.loadGlobalPartials({});

            assertEqual(0, statCalls);
            assertEqual(1, getCalls);
            assertEqual('hello', partials.get('global.html')({}));
        });
    });

    describe('getBaseTemplate', ({ it }) => {
        it('skips the stat() call when useTemplateCache is disabled', async () => {
            let statCalls = 0;
            let getCalls = 0;
            const store = {
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async statBaseTemplates() {
                    statCalls += 1;
                    return { etag: 'base-v1' };
                },
                async getBaseTemplates() {
                    getCalls += 1;
                    return {
                        etag: 'base-v1',
                        json() {
                            return [ { id: 'layout', source: 'LAYOUT' } ];
                        },
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const template = await service.getBaseTemplate({}, 'layout');

            assertEqual(0, statCalls);
            assertEqual(1, getCalls);
            assertEqual('LAYOUT', template({}));
        });
    });

    describe('getPageTemplate', ({ it }) => {
        it('skips the stat() call when useTemplateCache is disabled', async () => {
            let statCalls = 0;
            let getCalls = 0;
            const store = {
                normalizePathname(value) {
                    return value;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async statPageTemplate() {
                    statCalls += 1;
                    return { etag: 'page-template-v1' };
                },
                async getPageTemplate() {
                    getCalls += 1;
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-v1',
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const page = {
                pathname: '/articles/example',
                pageTemplateFilename: 'page.html',
                partials: null,
            };

            const template = await service.getPageTemplate({}, page);

            assertEqual(0, statCalls);
            assertEqual(1, getCalls);
            assertEqual('PAGE BODY', template({}));
        });
    });

    describe('assertCanonicalIdentifier', ({ it }) => {
        it('rejects an empty identifier even when the store accepts it', async () => {
            // The underlying isValidPathname() returns true for an empty string, so
            // this method must reject it on its own. It exists to validate
            // identifiers which may not have been checked by any earlier layer.
            const store = {
                isValidPathname() {
                    return true;
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const caught = await catchAsyncError(() => {
                return service.assertCanonicalIdentifier('', 'test identifier');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('test identifier'),
                `expected the caller context in the message; got "${ caught.message }"`,
            );
        });

        it('accepts a non-empty identifier the store considers valid', async () => {
            const store = {
                isValidPathname() {
                    return true;
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const caught = await catchAsyncError(() => {
                return service.assertCanonicalIdentifier('/articles/example', 'test identifier');
            });

            assertEqual(null, caught);
        });
    });

    describe('respondWithHypertext', ({ it }) => {
        it('refreshes partials before rendering a cached page template', async () => {
            let pagePartialDefs = [
                { id: 'page.html', source: 'first page partial' },
            ];
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: {
                    etag: 'page-partials-v1',
                    json() {
                        return pagePartialDefs;
                    },
                },
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const globalPartials = {
                etag: 'global-partials-v1',
                templates: [
                    { id: 'global.html', source: 'first global partial' },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return { etag: globalPartials.etag };
                },
                async getTemplatePartials() {
                    return {
                        etag: globalPartials.etag,
                        json() {
                            return globalPartials.templates;
                        },
                    };
                },
                async statPageTemplate() {
                    return { etag: 'page-template-v1' };
                },
                async getPageTemplate() {
                    return {
                        etag: 'page-template-v1',
                        text() {
                            return '{{> global.html }} / {{> page.html }}';
                        },
                    };
                },
                async statBaseTemplates() {
                    return { etag: 'base-template-v1' };
                },
                async getBaseTemplates() {
                    return {
                        etag: 'base-template-v1',
                        json() {
                            return [ { id: 'layout', source: '{{ body }}' } ];
                        },
                    };
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = {
                headers: new Headers(),
                url: new URL('https://example.com/articles/example'),
            };
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, request, response, { baseTemplateId: 'layout' });
            assertEqual('first global partial / first page partial', response.hypertext);

            globalPartials.etag = 'global-partials-v2';
            globalPartials.templates = [
                { id: 'global.html', source: 'second global partial' },
            ];
            pageContent.partials.etag = 'page-partials-v2';
            pagePartialDefs = [
                { id: 'page.html', source: 'second page partial' },
            ];

            await service.respondWithHypertext({}, request, response, { baseTemplateId: 'layout' });

            assertEqual('second global partial / second page partial', response.hypertext);
        });

        it('loads the matching page for a .json request', async () => {
            const requestedPathnames = [];
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return pageContent;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), allowJsonResponse: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const response = {
                props: {},
                status: 200,
                respondWithJSON() {
                    return this;
                },
            };

            await service.respondWithHypertext(
                {},
                {
                    headers: new Headers(),
                    url: new URL('https://example.com/articles/example.json'),
                },
                response,
                { skipBaseRender: true },
            );
            await service.respondWithHypertext(
                {},
                {
                    headers: new Headers(),
                    url: new URL('https://example.com/index.json'),
                },
                response,
                { skipBaseRender: true },
            );

            assertEqual('/articles/example', requestedPathnames[0]);
            assertEqual('/', requestedPathnames[1]);
        });

        it('resolves a nested "index.json" request to its directory page', async () => {
            // "/index" names a directory page, not a page called "index", at every
            // depth. Handling only the root would leave the ".json" affordance
            // broken for every directory page below it.
            const requestedPathnames = [];
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                // Mirror the real store: fold a trailing slash, except at the root.
                normalizePathname(value) {
                    return value.length > 1 ? value.replace(/\/+$/, '') : value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return pageContent;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), allowJsonResponse: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const response = {
                props: {},
                status: 200,
                respondWithJSON() {
                    return this;
                },
            };

            await service.respondWithHypertext(
                {},
                {
                    headers: new Headers(),
                    url: new URL('https://example.com/blog/index.json'),
                },
                response,
                { skipBaseRender: true },
            );
            await service.respondWithHypertext(
                {},
                {
                    headers: new Headers(),
                    url: new URL('https://example.com/index.json'),
                },
                response,
                { skipBaseRender: true },
            );

            assertEqual('/blog', requestedPathnames[0]);
            assertEqual('/', requestedPathnames[1]);
        });

        it('loads the matching page for an uppercase ".JSON" request', async () => {
            const requestedPathnames = [];
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return pageContent;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), allowJsonResponse: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const response = {
                props: {},
                status: 200,
                respondWithJSON() {
                    return this;
                },
            };

            await service.respondWithHypertext(
                {},
                {
                    headers: new Headers(),
                    url: new URL('https://example.com/articles/example.JSON'),
                },
                response,
                { skipBaseRender: true },
            );

            assertEqual('/articles/example', requestedPathnames[0]);
        });

        it('resolves a nested "index.JSON" request to its directory page', async () => {
            const requestedPathnames = [];
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                // Mirror the real store: fold a trailing slash, except at the root.
                normalizePathname(value) {
                    return value.length > 1 ? value.replace(/\/+$/, '') : value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return pageContent;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), allowJsonResponse: true });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const response = {
                props: {},
                status: 200,
                respondWithJSON() {
                    return this;
                },
            };

            await service.respondWithHypertext(
                {},
                {
                    headers: new Headers(),
                    url: new URL('https://example.com/blog/index.JSON'),
                },
                response,
                { skipBaseRender: true },
            );

            assertEqual('/blog', requestedPathnames[0]);
        });

        it('does not strip the ".json" extension when allowJsonResponse is disabled', async () => {
            // The ".json" extension is a development affordance. When JSON responses are
            // disabled the extension must stay part of the pathname, so the request
            // resolves no page instead of silently serving the HTML page at the
            // extensionless pathname under a second, non-canonical URL.
            const requestedPathnames = [];
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return null;
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = {
                headers: new Headers(),
                url: new URL('https://example.com/articles/example.json'),
            };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assertEqual('/articles/example.json', requestedPathnames[0]);
            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
        });

        it('does not remap "/index.json" to "/" when allowJsonResponse is disabled', async () => {
            const requestedPathnames = [];
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return null;
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = {
                headers: new Headers(),
                url: new URL('https://example.com/index.json'),
            };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assertEqual('/index.json', requestedPathnames[0]);
            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
        });

        it('does not strip an uppercase ".JSON" extension when allowJsonResponse is disabled', async () => {
            const requestedPathnames = [];
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage(_context, pathname) {
                    requestedPathnames.push(pathname);
                    return null;
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = {
                headers: new Headers(),
                url: new URL('https://example.com/articles/example.JSON'),
            };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assertEqual('/articles/example.JSON', requestedPathnames[0]);
            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
        });

        it('renders skipBaseRender without requiring options.baseTemplateId', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };

            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
                async statPageTemplate() {
                    return null;
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = { url: new URL('https://example.com/articles/example') };

            let respondedWith;
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(status, hypertext, responseOptions) {
                    respondedWith = { status, hypertext, responseOptions };
                    return this;
                },
            };

            await service.respondWithHypertext({}, request, response, { skipBaseRender: true });

            assertEqual('PAGE BODY', respondedWith.hypertext);
        });

        it('throws when options.baseTemplateId is missing for full-page rendering', async () => {
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, {});
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('skips rendered-page cache work when page caching is disabled', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    throw new Error('unexpected rendered-page cache operation');
                },
                async getTemplatePartials() {
                    return null;
                },
                async statBaseTemplates() {
                    throw new Error('unexpected rendered-page cache operation');
                },
                async getBaseTemplates() {
                    return {
                        etag: 'base-etag-1',
                        json() {
                            return [ { id: 'layout', source: 'LAYOUT[{{ body }}]' } ];
                        },
                    };
                },
                async hashValue() {
                    throw new Error('unexpected rendered-page cache operation');
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
            };
            const kvStore = {
                async get() {
                    throw new Error('unexpected rendered-page cache operation');
                },
                async put() {
                    throw new Error('unexpected rendered-page cache operation');
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, request, response, { baseTemplateId: 'layout' });

            assertEqual('LAYOUT[PAGE BODY]', response.hypertext);
        });

        it('skips rendered-page cache work when page caching is disabled per call', async () => {
            const { store } = makePropsCacheKeyFixtures();
            store.statTemplatePartials = async function statTemplatePartials() {
                throw new Error('unexpected rendered-page cache operation');
            };
            store.hashValue = async function hashValue() {
                throw new Error('unexpected rendered-page cache operation');
            };

            const kvStore = {
                async get() {
                    throw new Error('unexpected rendered-page cache operation');
                },
                async put() {
                    throw new Error('unexpected rendered-page cache operation');
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, request, response, {
                skipBaseRender: true,
                usePageCache: false,
            });

            assertEqual('PAGE BODY', response.hypertext);
        });

        it('partitions the rendered-page cache by request origin', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };

            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
                async statPageTemplate() {
                    return null;
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
            };

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const responseA = {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            };
            const requestA = { url: new URL('https://host-a.example/articles/example') };
            await service.respondWithHypertext({}, requestA, responseA, { skipBaseRender: true });

            const responseB = {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            };
            const requestB = { url: new URL('https://host-b.example/articles/example') };
            await service.respondWithHypertext({}, requestB, responseB, { skipBaseRender: true });

            assertEqual(2, putKeys.length);
            // The key is a hashed, opaque identity (see Issue 3), so partitioning is
            // observed as distinct keys, not as the raw origin appearing in the key.
            assert(putKeys[0] !== putKeys[1], 'expected different cache keys for different origins');
        });

        it('keeps the rendered-page cache key within the portable 512-byte KV limit for a very long URL', async () => {
            const { store } = makePropsCacheKeyFixtures();
            store.hashValue = makeOpaqueHashValue();

            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore: makeSizeBoundedKvStore() });

            const longSegment = 'x'.repeat(2000);
            const request = { url: new URL(`https://example.com/articles/${ longSegment }?query=${ longSegment }`) };
            const response = {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assertEqual(null, caught);
        });

        it('does not leak the raw query string into the cache key or debug logs', async () => {
            const { store } = makePropsCacheKeyFixtures();
            store.hashValue = makeOpaqueHashValue();

            const debugCalls = [];
            const logger = {
                createChild() {
                    return {
                        debug(message, fields) {
                            debugCalls.push({ message, fields });
                        },
                    };
                },
            };

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({ logger, usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const secret = 'SUPER-SECRET-QUERY-VALUE';
            const request = { url: new URL(`https://example.com/articles/example?token=${ secret }`) };
            const response = {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            };

            await service.respondWithHypertext({}, request, response, { skipBaseRender: true });

            assertEqual(1, putKeys.length);
            assert(!putKeys[0].includes(secret), `expected no raw query string in the cache key; got "${ putKeys[0] }"`);

            assert(debugCalls.length > 0, 'expected at least one debug log call');
            for (const call of debugCalls) {
                const serialized = JSON.stringify(call);
                assert(
                    !serialized.includes(secret),
                    `expected no raw query string in a cache diagnostic log; got "${ serialized }"`,
                );
            }
        });

        it('partitions the rendered-page cache by render mode', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: {
                    etag: 'page-partials-v1',
                    json() {
                        return [ { id: 'header.html', source: 'HEADER' } ];
                    },
                },
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
                async statPageTemplate() {
                    return null;
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
                async statBaseTemplates() {
                    return null;
                },
                async getBaseTemplates() {
                    return {
                        etag: 'base-etag-1',
                        json() {
                            return [ { id: 'layout', source: 'LAYOUT[{{ body }}]' } ];
                        },
                    };
                },
            };

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { partial: 'header.html' });

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { skipBaseRender: true });

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { baseTemplateId: 'layout' });

            assertEqual(3, putKeys.length);
            assertEqual(3, new Set(putKeys).size);
        });

        it('partitions the rendered-page cache by the selected partial identifier', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: {
                    etag: 'page-partials-v1',
                    json() {
                        return [
                            { id: 'header.html', source: 'HEADER' },
                            { id: 'footer.html', source: 'FOOTER' },
                        ];
                    },
                },
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
            };

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { partial: 'header.html' });

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { partial: 'footer.html' });

            assertEqual(2, putKeys.length);
            assert(putKeys[0] !== putKeys[1], 'expected different cache keys for different partial identifiers');
        });

        it('partitions the rendered-page cache by page content etag', async () => {
            const { pageContent, store } = makePropsCacheKeyFixtures();

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { skipBaseRender: true });

            pageContent.etag = 'page-etag-2';

            await service.respondWithHypertext({}, request, {
                props: {},
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { skipBaseRender: true });

            assertEqual(2, putKeys.length);
            assert(putKeys[0] !== putKeys[1], 'expected different cache keys for different page content etags');
        });

        it('throws a labeled assertion when the page template blob is absent', async () => {
            // The page metadata declares a pageTemplateFilename, so a missing blob
            // violates an invariant the build is supposed to guarantee. It must fail
            // as a labeled assertion naming the page, not as a TypeError raised by
            // calling text() on null.
            const { store } = makePropsCacheKeyFixtures();

            store.getPageTemplate = async function getPageTemplate() {
                return null;
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('page.html'),
                `expected the page template filename in the message; got "${ caught.message }"`,
            );
            assert(
                caught.message.includes('/articles/example'),
                `expected the page pathname in the message; got "${ caught.message }"`,
            );
        });

        it('honors the constructor-level includePropsInCacheKey default', async () => {
            // Response props are merged into the page context and change rendered
            // output, so a deployment which caches pages while passing per-request
            // props must be able to set this once, in the constructor, rather than
            // relying on every call site to remember the per-call option.
            const { store } = makePropsCacheKeyFixtures();

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({
                logger: makeLogger(),
                usePageCache: true,
                includePropsInCacheKey: true,
            });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };

            await service.respondWithHypertext({}, request, {
                props: { viewer: 'alice' },
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { skipBaseRender: true });

            await service.respondWithHypertext({}, request, {
                props: { viewer: 'bob' },
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, { skipBaseRender: true });

            assertEqual(2, putKeys.length);
            assert(
                putKeys[0] !== putKeys[1],
                'expected different cache keys for different response props',
            );
        });

        it('allows a per-call includePropsInCacheKey to override the constructor default', async () => {
            const { store } = makePropsCacheKeyFixtures();

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({
                logger: makeLogger(),
                usePageCache: true,
                includePropsInCacheKey: true,
            });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };
            const options = { skipBaseRender: true, includePropsInCacheKey: false };

            await service.respondWithHypertext({}, request, {
                props: { viewer: 'alice' },
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, options);

            await service.respondWithHypertext({}, request, {
                props: { viewer: 'bob' },
                status: 200,
                respondWithUtf8() {
                    return this;
                },
            }, options);

            assertEqual(2, putKeys.length);
            assertEqual(putKeys[0], putKeys[1]);
        });

        it('includes options.baseTemplateId in the full-page cache key', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };

            // Both layouts live in the same bundle, so statBaseTemplates() reports
            // one bundle-wide etag regardless of which templateId is selected.
            const baseTemplatesBundle = [
                { id: 'layout-a', source: 'LAYOUT-A[{{ body }}]' },
                { id: 'layout-b', source: 'LAYOUT-B[{{ body }}]' },
            ];

            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
                async statPageTemplate() {
                    return null;
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
                async statBaseTemplates() {
                    return { etag: 'base-etag-1' };
                },
                async getBaseTemplates() {
                    return {
                        etag: 'base-etag-1',
                        json() {
                            return baseTemplatesBundle;
                        },
                    };
                },
            };

            const putKeys = [];
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key) {
                    putKeys.push(key);
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: store, kvStore });

            const request = { url: new URL('https://example.com/articles/example') };

            const responseA = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };
            await service.respondWithHypertext({}, request, responseA, { baseTemplateId: 'layout-a' });

            const responseB = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };
            await service.respondWithHypertext({}, request, responseB, { baseTemplateId: 'layout-b' });

            assertEqual(2, putKeys.length);
            assert(putKeys[0] !== putKeys[1], 'expected different cache keys for different base templates');
            assertEqual('LAYOUT-A[PAGE BODY]', responseA.hypertext);
            assertEqual('LAYOUT-B[PAGE BODY]', responseB.hypertext);
        });

        it('throws when a named partial renders empty', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: {
                    etag: 'page-partials-v1',
                    json() {
                        // Non-empty source that renders to an empty string, so the
                        // failure comes from the render-output check under test,
                        // not the earlier non-empty-source assertion.
                        return [ { id: 'empty.html', source: '{{#missing}}content{{/missing}}' } ];
                    },
                },
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { partial: 'empty.html' });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('partial "empty.html"'),
                `expected the render mode in the message; got "${ caught.message }"`,
            );
            assert(
                caught.message.includes('/articles/example'),
                `expected the page pathname in the message; got "${ caught.message }"`,
            );
        });

        it('throws when the page template renders empty without a base template', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
                async statPageTemplate() {
                    return null;
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return '';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('page template'),
                `expected the render mode in the message; got "${ caught.message }"`,
            );
            assert(
                caught.message.includes('/articles/example'),
                `expected the page pathname in the message; got "${ caught.message }"`,
            );
        });

        it('throws when the full page renders empty', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-etag-1',
                pageDataFiles: [
                    { json() {
                        return { page: {} };
                    } },
                ],
            };
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return pageContent;
                },
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async hashValue(value) {
                    return `hash:${ value }`;
                },
                async statPageTemplate() {
                    return null;
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-etag-1',
                    };
                },
                async statBaseTemplates() {
                    return null;
                },
                async getBaseTemplates() {
                    return {
                        etag: 'base-etag-1',
                        json() {
                            // Non-empty source that renders to an empty string; see the
                            // partial test above for why this avoids the source assertion.
                            return [ { id: 'empty-layout', source: '{{#missing}}content{{/missing}}' } ];
                        },
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: store, kvStore: {} });

            const request = { url: new URL('https://example.com/articles/example') };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { baseTemplateId: 'empty-layout' });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('full page'),
                `expected the render mode in the message; got "${ caught.message }"`,
            );
            assert(
                caught.message.includes('/articles/example'),
                `expected the page pathname in the message; got "${ caught.message }"`,
            );
        });
    });
});
