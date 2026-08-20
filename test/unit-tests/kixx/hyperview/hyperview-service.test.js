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

// Lets a test control exactly when an awaited store call resolves, so two
// concurrent HyperviewService calls can be driven through a specific
// interleaving instead of relying on real timing.
function makeDeferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

// Content reads now run through request-scoped snapshots. This adapter keeps
// focused test doubles concise while matching the production boundary: pure
// helpers stay on the store and all content reads are exposed by a snapshot.
function makeSnapshot(store) {
    const readMethods = [
        'getPage',
        'statTemplatePartials',
        'getTemplatePartials',
        'statBaseTemplates',
        'getBaseTemplates',
        'statPageTemplate',
        'getPageTemplate',
    ];
    const snapshot = {};

    for (const methodName of readMethods) {
        if (typeof store[methodName] === 'function') {
            snapshot[methodName] = (...args) => store[methodName](undefined, ...args);
        }
    }

    return snapshot;
}

function makeContentStore(store) {
    return {
        ...store,
        async openSnapshot() {
            return makeSnapshot(store);
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

    describe('construction and initialization', ({ it }) => {
        it('requires a logger when constructed', async () => {
            const caught = await catchAsyncError(() => new HyperviewService());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(caught.message.includes('logger'), `expected logger in "${ caught.message }"`);
        });

        it('requires both stores when initialized', async () => {
            const service = new HyperviewService({ logger: makeLogger() });

            const missingKvStore = await catchAsyncError(() => {
                return service.initialize({ contentAddressableStore: {} });
            });
            const missingContentStore = await catchAsyncError(() => {
                return service.initialize({ kvStore: {} });
            });

            assertEqual('AssertionError', missingKvStore.name);
            assert(missingKvStore.message.includes('kvStore'));
            assertEqual('AssertionError', missingContentStore.name);
            assert(missingContentStore.message.includes('contentAddressableStore'));
        });
    });

    describe('template creation', ({ it }) => {
        it('renders a mini template with the supplied page context', () => {
            const service = new HyperviewService({ logger: makeLogger() });
            const template = service.createMiniTemplate('page.title', 'Welcome, {{ viewer.name }}!');

            assertEqual('Welcome, Ada!', template({ viewer: { name: 'Ada' } }));
        });

        it('reuses a current base template when template caching is enabled', async () => {
            let baseTemplateLoads = 0;
            const store = {
                async statTemplatePartials() {
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async statBaseTemplates() {
                    return { etag: 'base-v1' };
                },
                async getBaseTemplates() {
                    baseTemplateLoads += 1;
                    return {
                        etag: 'base-v1',
                        json() {
                            return [ { id: 'layout', source: '<main>{{ body }}</main>' } ];
                        },
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const first = await service.getBaseTemplate(makeSnapshot(store), 'layout');
            const second = await service.getBaseTemplate(makeSnapshot(store), 'layout');

            assertEqual(1, baseTemplateLoads);
            assertEqual(first, second);
            assertEqual('<main>Body</main>', first({ body: 'Body' }, new Map()));
        });
    });

    describe('getPagePartials', ({ it }) => {
        it('returns a fresh empty Map for a page which declares no partials', async () => {
            const store = {};
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = { pathname: '/articles/example', partials: null };

            const first = await service.getPagePartials(page);
            const second = await service.getPagePartials(page);

            assertEqual(0, first.size);
            assert(first !== second, 'expected a new per-render Map');
        });

        it('keeps a cached bundle immutable when a page stops declaring partials', async () => {
            const store = {};
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = {
                pathname: '/articles/example',
                partials: {
                    etag: 'page-v1',
                    partials: [
                        { id: 'page.html', source: 'PAGE PARTIAL' },
                    ],
                },
            };

            const populated = await service.getPagePartials(page);
            assertEqual(1, populated.size);

            page.partials = null;
            const emptied = await service.getPagePartials(page);

            assert(populated !== emptied, 'expected the prior bundle to remain independent');
            assertEqual(1, populated.size);
            assertEqual(0, emptied.size);
        });

        it('does not retain a partials Map when useTemplateCache is disabled', async () => {
            const store = {};
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = { pathname: '/articles/example', partials: null };

            const first = await service.getPagePartials(page);
            const second = await service.getPagePartials(page);

            assertEqual(0, first.size);
            assert(first !== second, 'expected a fresh Map instance on each call');
        });

        it('reuses compiled page partials across a global-partials change', async () => {
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore({}), kvStore: {} });
            const page = {
                pathname: '/articles/example',
                partials: {
                    etag: 'page-v1',
                    partials: [ { id: 'page.html', source: '{{> global.html }}' } ],
                },
            };

            const first = await service.getPagePartials(page);
            const second = await service.getPagePartials(page);

            assert(first === second, 'expected the page-partials bundle to be reused by its own etag');
            assertEqual('global-v2', first.get('page.html')({}, new Map([
                [ 'global.html', () => 'global-v2' ],
                ...first,
            ])));
        });
    });

    describe('snapshot consistency', ({ it }) => {
        it('does not share global-partials loads across snapshots with different etags', async () => {
            const firstLoad = makeDeferred();
            const secondLoad = makeDeferred();
            let loads = 0;
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({
                contentAddressableStore: makeContentStore({}),
                kvStore: {},
            });
            const firstSnapshot = {
                async statTemplatePartials() {
                    return { etag: 'global-v1' };
                },
                async getTemplatePartials() {
                    loads += 1;
                    return firstLoad.promise;
                },
            };
            const secondSnapshot = {
                async statTemplatePartials() {
                    return { etag: 'global-v2' };
                },
                async getTemplatePartials() {
                    loads += 1;
                    return secondLoad.promise;
                },
            };

            const first = service.loadGlobalPartials(firstSnapshot);
            const second = service.loadGlobalPartials(secondSnapshot);

            firstLoad.resolve({
                etag: 'global-v1',
                json() { return [] },
            });
            secondLoad.resolve({
                etag: 'global-v2',
                json() { return [] },
            });

            await Promise.all([first, second]);
            assertEqual(2, loads);
        });
    });

    describe('loadGlobalPartials', ({ it }) => {
        it('reads the snapshot stat when useTemplateCache is disabled', async () => {
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const partials = await service.loadGlobalPartials(makeSnapshot(store));

            assertEqual(1, statCalls);
            assertEqual(1, getCalls);
            assertEqual('hello', partials.get('global.html')({}, new Map()));
        });
    });

    describe('getBaseTemplate', ({ it }) => {
        it('reads the snapshot stat when useTemplateCache is disabled', async () => {
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const template = await service.getBaseTemplate(makeSnapshot(store), 'layout');

            assertEqual(1, statCalls);
            assertEqual(1, getCalls);
            assertEqual('LAYOUT', template({}, new Map()));
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = {
                pathname: '/articles/example',
                pageTemplateFilename: 'page.html',
                partials: null,
            };

            const template = await service.getPageTemplate(makeSnapshot(store), page);

            assertEqual(1, statCalls);
            assertEqual(1, getCalls);
            assertEqual('PAGE BODY', template({}, new Map()));
        });

        it('reuses a page template when only its page-partials bundle changes', async () => {
            const page = {
                pathname: '/articles/example',
                pageTemplateFilename: 'page.html',
                partials: {
                    etag: 'page-partials-v1',
                    partials: [ { id: 'x.html', source: 'V1 CONTENT' } ],
                },
            };

            const store = {
                normalizePathname(value) {
                    return value;
                },
                async statPageTemplate() {
                    return { etag: 'page-template-v1' };
                },
                async getPageTemplate() {
                    return {
                        text() {
                            return '{{> x.html }}';
                        },
                        etag: 'page-template-v1',
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const template = await service.getPageTemplate(makeSnapshot(store), page);
            const pagePartials = await service.getPagePartials(page);

            assertEqual('V1 CONTENT', template({}, pagePartials));

            page.partials = {
                etag: 'page-partials-v2',
                partials: [ { id: 'x.html', source: 'V2 CONTENT' } ],
            };

            const secondTemplate = await service.getPageTemplate(makeSnapshot(store), page);
            const secondPagePartials = await service.getPagePartials(page);

            assert(template === secondTemplate, 'expected the compiled page template to be reused');
            assertEqual('V2 CONTENT', secondTemplate({}, secondPagePartials));
        });

        it('does not force a redundant recompile on a second request for a page with no partials', async () => {
            let templateFetchCount = 0;
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
                    return { etag: 'page-template-v1' };
                },
                async getPageTemplate() {
                    templateFetchCount += 1;
                    return {
                        text() {
                            return 'PAGE BODY';
                        },
                        etag: 'page-template-v1',
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = {
                pathname: '/articles/example',
                pageTemplateFilename: 'page.html',
                partials: null,
            };

            await service.getPageTemplate(makeSnapshot(store), page);
            await service.getPageTemplate(makeSnapshot(store), page);

            assertEqual(1, templateFetchCount);
        });

        it('recompiles a page template when its own etag changes', async () => {
            let etag = 'page-template-v1';
            let source = 'V1';
            const store = {
                normalizePathname(value) {
                    return value;
                },
                async statPageTemplate() {
                    return { etag };
                },
                async getPageTemplate() {
                    return {
                        etag,
                        text() {
                            return source;
                        },
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), useTemplateCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });
            const page = {
                pathname: '/articles/example',
                pageTemplateFilename: 'page.html',
                partials: null,
            };

            const first = await service.getPageTemplate(makeSnapshot(store), page);
            etag = 'page-template-v2';
            source = 'V2';
            const second = await service.getPageTemplate(makeSnapshot(store), page);

            assert(first !== second, 'expected a new compiled function for a new template etag');
            assertEqual('V2', second({}, new Map()));
        });
    });

    describe('getPage', ({ it }) => {
        it('returns null when the page metadata declares no page template', async () => {
            // A page directory can carry page.json metadata with no template of
            // its own -- an ancestor directory published only to supply
            // inherited defaults for its descendants, for example. Requesting
            // that pathname directly must resolve as "nothing to render here",
            // not crash the process.
            const store = {
                async getPage() {
                    return {
                        pageTemplateFilename: null,
                        partials: null,
                        includes: null,
                        etag: 'page-etag-1',
                        pageDataFiles: [
                            { json() {
                                return { page: {} };
                            } },
                        ],
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = await service.getPage(makeSnapshot(store), new URL('https://example.com/blog'), '/blog', {});

            assertEqual(null, page);
        });

        it('returns the loaded page when a page template is declared', async () => {
            const store = {
                async getPage() {
                    return {
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
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const page = await service.getPage(makeSnapshot(store), new URL('https://example.com/blog'), '/blog', {});

            assert(page, 'expected a page to be returned');
            assertEqual('page.html', page.pageTemplateFilename);
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const caught = await catchAsyncError(() => {
                return service.assertCanonicalIdentifier('/articles/example', 'test identifier');
            });

            assertEqual(null, caught);
        });
    });

    describe('respondWithHypertext', ({ it }) => {
        it('renders a global partial referenced by a page partial', async () => {
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return {
                        pageTemplateFilename: 'page.html',
                        partials: {
                            etag: 'page-partials-v1',
                            json() {
                                return [ { id: 'fragment.html', source: '{{> global.html }}' } ];
                            },
                        },
                        includes: null,
                        etag: 'page-v1',
                        pageDataFiles: [ {
                            json() {
                                return { page: {} };
                            },
                        } ],
                    };
                },
                async statTemplatePartials() {
                    return { etag: 'global-partials-v1' };
                },
                async getTemplatePartials() {
                    return {
                        etag: 'global-partials-v1',
                        json() {
                            return [ { id: 'global.html', source: 'GLOBAL' } ];
                        },
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, {
                headers: new Headers(),
                url: new URL('https://example.com/articles/example'),
            }, response, { partial: 'fragment.html' });

            assertEqual('GLOBAL', response.hypertext);
        });

        it('recognizes JSON requests by representation suffix or Accept header', () => {
            const service = new HyperviewService({ logger: makeLogger() });

            assert(service.isJsonRequest({
                url: new URL('https://example.com/articles.json'),
                headers: new Headers(),
            }));
            assert(service.isJsonRequest({
                url: new URL('https://example.com/articles'),
                headers: new Headers({ accept: 'text/html, application/json' }),
            }));
            assert(!service.isJsonRequest({
                url: new URL('https://example.com/articles'),
                headers: new Headers({ accept: 'text/html' }),
            }));
        });

        it('opens exactly one snapshot for JSON and rendered-page cache-hit responses', async () => {
            let openSnapshotCalls = 0;
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: null,
                includes: null,
                etag: 'page-v1',
                pageDataFiles: [ {
                    json() { return { page: {} } },
                } ],
            };
            const snapshot = {
                async getPage() { return pageContent },
                async statTemplatePartials() { return null },
                async statBaseTemplates() { return { etag: 'base-v1' } },
            };
            const store = {
                isValidPathname(value) { return typeof value === 'string' && value.length > 0 },
                normalizePathname(value) { return value },
                async openSnapshot() {
                    openSnapshotCalls += 1;
                    return snapshot;
                },
                async hashValue(value) { return `hash:${ value }` },
            };
            const service = new HyperviewService({ logger: makeLogger(), allowJsonResponse: true, usePageCache: true });
            service.initialize({
                contentAddressableStore: store,
                kvStore: { async get() { return 'cached' } },
            });
            const jsonResponse = {
                props: {},
                status: 200,
                respondWithJSON() { return this },
            };
            const htmlResponse = {
                props: {},
                status: 200,
                respondWithUtf8() { return this },
            };

            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles'),
                headers: new Headers({ accept: 'application/json' }),
            }, jsonResponse, { baseTemplateId: 'layout' });
            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles'), headers: new Headers(),
            }, htmlResponse, { baseTemplateId: 'layout' });

            assertEqual(2, openSnapshotCalls);
        });

        it('renders and keys a response from the snapshot that loaded its page', async () => {
            let v2Published = false;
            const hashInputs = [];
            const snapshot = {
                async getPage() {
                    v2Published = true;
                    return {
                        pageTemplateFilename: 'page.html',
                        partials: null,
                        includes: null,
                        etag: 'page-v1',
                        pageDataFiles: [ {
                            json() { return { page: {} } },
                        } ],
                    };
                },
                async statTemplatePartials() {
                    assert(v2Published, 'expected V2 publication after page loading');
                    return { etag: 'partials-v1' };
                },
                async getTemplatePartials() { return null },
                async statPageTemplate() {
                    assert(v2Published, 'expected V2 publication before template loading');
                    return { etag: 'template-v1' };
                },
                async getPageTemplate() {
                    assert(v2Published, 'expected V2 publication before template loading');
                    return {
                        etag: 'template-v1',
                        text() { return 'V1 BODY' },
                    };
                },
            };
            const store = {
                isValidPathname(value) { return typeof value === 'string' && value.length > 0 },
                normalizePathname(value) { return value },
                async openSnapshot() { return snapshot },
                async hashValue(value) {
                    hashInputs.push(value);
                    return `hash:${ hashInputs.length }`;
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({
                contentAddressableStore: store,
                kvStore: {
                    async get() { return null },
                    async put() {},
                },
            });
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles/example'), headers: new Headers(),
            }, response, { skipBaseRender: true });

            assertEqual('V1 BODY', response.hypertext);
            assert(hashInputs.includes('page-v1#partials-v1'));
            assert(!hashInputs.some((input) => String(input).includes('v2')));
        });

        it('keeps concurrent V1 and V2 renders, partials, and page-cache writes separate', async () => {
            const firstPartialsStarted = makeDeferred();
            const releaseFirstPartials = makeDeferred();
            const cacheWrites = [];
            let snapshotsOpened = 0;

            function makeVersionedSnapshot(version, waitForPartials) {
                return {
                    async getPage() {
                        return {
                            pageTemplateFilename: 'page.html',
                            partials: {
                                etag: `page-partials-${ version }`,
                                json() {
                                    return [ {
                                        id: 'page.html',
                                        source: '{{> global.html }}',
                                    } ];
                                },
                            },
                            includes: null,
                            etag: `page-${ version }`,
                            pageDataFiles: [ {
                                json() { return { page: {} } },
                            } ],
                        };
                    },
                    async statTemplatePartials() {
                        return { etag: `global-${ version }` };
                    },
                    async getTemplatePartials() {
                        if (waitForPartials) {
                            firstPartialsStarted.resolve();
                            await releaseFirstPartials.promise;
                        }
                        return {
                            etag: `global-${ version }`,
                            json() {
                                return [ { id: 'global.html', source: version } ];
                            },
                        };
                    },
                    async statPageTemplate() {
                        return { etag: `template-${ version }` };
                    },
                    async getPageTemplate() {
                        return {
                            etag: `template-${ version }`,
                            text() { return '{{> page.html }}' },
                        };
                    },
                };
            }

            const v1 = makeVersionedSnapshot('V1', true);
            const v2 = makeVersionedSnapshot('V2', false);
            const store = {
                isValidPathname(value) { return typeof value === 'string' && value.length > 0 },
                normalizePathname(value) { return value },
                async openSnapshot() {
                    snapshotsOpened += 1;
                    return snapshotsOpened === 1 ? v1 : v2;
                },
                async hashValue(value) { return `hash:${ value }` },
            };
            const service = new HyperviewService({
                logger: makeLogger(),
                usePageCache: true,
                useTemplateCache: true,
            });
            service.initialize({
                contentAddressableStore: store,
                kvStore: {
                    async get() { return null },
                    async put(_context, key, value) {
                        cacheWrites.push({ key, value });
                    },
                },
            });
            const request = {
                headers: new Headers(),
                url: new URL('https://example.com/articles/example'),
            };
            const firstResponse = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };
            const secondResponse = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            const firstRender = service.respondWithHypertext({}, request, firstResponse, { skipBaseRender: true });
            await firstPartialsStarted.promise;
            const secondRender = service.respondWithHypertext({}, request, secondResponse, { skipBaseRender: true });
            await secondRender;
            releaseFirstPartials.resolve();
            await firstRender;

            assertEqual('V1', firstResponse.hypertext);
            assertEqual('V2', secondResponse.hypertext);
            assertEqual(2, cacheWrites.length);
            assert(cacheWrites.some(({ key, value }) => key.includes('page-V1#global-V1') && value === 'V1'));
            assert(cacheWrites.some(({ key, value }) => key.includes('page-V2#global-V2') && value === 'V2'));
        });

        it('returns assembled page context for an allowed JSON Accept request', async () => {
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return {
                        pageTemplateFilename: 'page.html',
                        partials: null,
                        includes: null,
                        etag: 'page-v1',
                        pageDataFiles: [ {
                            json() {
                                return { page: { title: 'Article' } };
                            },
                        } ],
                    };
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), allowJsonResponse: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });
            const response = {
                props: { viewer: { name: 'Ada' } },
                status: 200,
                respondWithJSON(status, body, options) {
                    this.json = { status, body, options };
                    return this;
                },
            };

            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles/example'),
                headers: new Headers({ accept: 'application/json' }),
            }, response, { skipBaseRender: true });

            assertEqual(200, response.json.status);
            assertEqual('Article', response.json.body.page.title);
            assertEqual('Ada', response.json.body.viewer.name);
            assertEqual(4, response.json.options.whiteSpace);
        });

        it('renders a named page partial with the assembled page context', async () => {
            const pageContent = {
                pageTemplateFilename: 'page.html',
                partials: {
                    etag: 'partials-v1',
                    json() {
                        return [ { id: 'card.html', source: '<article>{{ viewer.name }}</article>' } ];
                    },
                },
                includes: null,
                etag: 'page-v1',
                pageDataFiles: [ {
                    json() {
                        return { page: {} };
                    },
                } ],
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
            };
            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });
            const response = {
                props: { viewer: { name: 'Ada' } },
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles/example'),
                headers: new Headers(),
            }, response, { partial: 'card.html' });

            assertEqual('<article>Ada</article>', response.hypertext);
        });

        it('serves a rendered-page cache hit without loading the page template', async () => {
            let pageTemplateLoads = 0;
            const { store } = makePropsCacheKeyFixtures();
            const kvStore = {
                async get(_context, key, options) {
                    this.key = key;
                    this.options = options;
                    return 'CACHED PAGE';
                },
                async put() {
                    throw new Error('must not write after a cache hit');
                },
            };
            const originalGetPageTemplate = store.getPageTemplate;
            store.getPageTemplate = async function getPageTemplate() {
                pageTemplateLoads += 1;
                return await originalGetPageTemplate();
            };
            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles/example'),
                headers: new Headers(),
            }, response, { skipBaseRender: true, pageCacheReadTtlSeconds: 120 });

            assertEqual('CACHED PAGE', response.hypertext);
            assertEqual(0, pageTemplateLoads);
            assertEqual('text', kvStore.options.type);
            assertEqual(120, kvStore.options.cacheTtl);
        });

        it('writes a successful rendered page to the cache with the configured expiration', async () => {
            const { store } = makePropsCacheKeyFixtures();
            const kvStore = {
                async get() {
                    return null;
                },
                async put(_context, key, value, options) {
                    this.write = { key, value, options };
                },
            };
            const service = new HyperviewService({ logger: makeLogger(), usePageCache: true });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });
            const response = {
                props: {},
                status: 200,
                respondWithUtf8(_status, hypertext) {
                    this.hypertext = hypertext;
                    return this;
                },
            };

            await service.respondWithHypertext({}, {
                url: new URL('https://example.com/articles/example'),
                headers: new Headers(),
            }, response, { skipBaseRender: true, pageCacheExpirationSeconds: 240 });

            assertEqual('PAGE BODY', response.hypertext);
            assertEqual('PAGE BODY', kvStore.write.value);
            assertEqual('text', kvStore.write.options.type);
            assertEqual(240, kvStore.write.options.ttlSeconds);
        });

        it('uses refreshed partials without recompiling cached page and base templates', async () => {
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });
            const compileTemplate = service.compileTemplate.bind(service);
            let compilationCount = 0;
            service.compileTemplate = (...args) => {
                compilationCount += 1;
                return compileTemplate(...args);
            };

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
            const firstCompilationCount = compilationCount;

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
            assertEqual(firstCompilationCount + 2, compilationCount);
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
                    return null;
                },
                async getTemplatePartials() {
                    return null;
                },
                async statBaseTemplates() {
                    return { etag: 'base-etag-1' };
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
                async statPageTemplate() {
                    return { etag: 'page-template-etag-1' };
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
                return null;
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: makeSizeBoundedKvStore() });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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

        it('throws NotFoundError, not a crash, when the page has metadata but no page template', async () => {
            // A page directory can carry page.json metadata with no template of
            // its own -- an ancestor directory published only to supply
            // inherited defaults for its descendants, for example. A direct
            // request for that pathname is a missing resource from the caller's
            // perspective, the same as no page metadata at all -- contrast with
            // the next test, where the metadata names a template that the blob
            // store fails to produce, which is a build invariant violation.
            const store = {
                isValidPathname(value) {
                    return typeof value === 'string' && value.length > 0;
                },
                normalizePathname(value) {
                    return value;
                },
                async getPage() {
                    return {
                        pageTemplateFilename: null,
                        partials: null,
                        includes: null,
                        etag: 'page-etag-1',
                        pageDataFiles: [
                            { json() {
                                return { page: {} };
                            } },
                        ],
                    };
                },
            };

            const service = new HyperviewService({ logger: makeLogger() });
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

            const request = { url: new URL('https://example.com/blog') };
            const response = { props: {}, status: 200 };

            const caught = await catchAsyncError(() => {
                return service.respondWithHypertext({}, request, response, { skipBaseRender: true });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
            service.initialize({ contentAddressableStore: makeContentStore(store), kvStore: {} });

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
