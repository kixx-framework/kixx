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

    describe('respondWithHypertext', ({ it }) => {
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

        it('includes the request origin in the default page-cache key', async () => {
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
            assert(putKeys[0] !== putKeys[1], 'expected different cache keys for different origins');
            assert(putKeys[0].includes('host-a.example'), 'expected cache key to include the request origin');
            assert(putKeys[1].includes('host-b.example'), 'expected cache key to include the request origin');
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
    });
});
