import { describe } from 'kixx-test';
import { assert, assertEqual, assertFunction, assertMatches, isPlainObject } from 'kixx-assert';
import sinon from 'sinon';
import HyperviewService from '../../../lib/hyperview/hyperview-service.js';


function createMockPageStore(overrides = {}) {
    return {
        doesPageExist: sinon.fake.resolves(false),
        getPageData: sinon.fake.resolves({}),
        getPageTemplate: sinon.fake.resolves(null),
        getMarkdownContent: sinon.fake.resolves([]),
        ...overrides,
    };
}

function createMockTemplateStore(overrides = {}) {
    return {
        getBaseTemplate: sinon.fake.resolves(null),
        loadPartialFiles: sinon.fake.resolves([]),
        loadHelperFiles: sinon.fake.resolves([]),
        ...overrides,
    };
}

function createMockTemplateEngine(overrides = {}) {
    return {
        // Return a function that returns the source it was compiled from, so that
        // hydratePageData() does not erase title/description fields when rendering
        // them as metadata templates
        compileTemplate: sinon.fake((_templateId, source) => () => source),
        ...overrides,
    };
}

function createMockStaticFileServerStore(overrides = {}) {
    return {
        getFile: sinon.fake.resolves(null),
        ...overrides,
    };
}

function createService({ pageStore, templateStore, templateEngine, staticFileServerStore } = {}) {
    return new HyperviewService({
        pageStore: pageStore || createMockPageStore(),
        templateStore: templateStore || createMockTemplateStore(),
        templateEngine: templateEngine || createMockTemplateEngine(),
        staticFileServerStore: staticFileServerStore || createMockStaticFileServerStore(),
    });
}

const MOCK_URL = {
    protocol: 'https:',
    host: 'example.com',
    pathname: '/blog/post',
    href: 'https://example.com/blog/post',
};

const MOCK_REQUEST = { url: MOCK_URL };
const MOCK_RESPONSE = { props: {} };


// --- initialize() ---

describe('HyperviewService#initialize() with no helper files', ({ before, it }) => {
    let templateStore;

    before(async () => {
        templateStore = createMockTemplateStore({
            loadHelperFiles: sinon.fake.resolves([]),
        });
        const service = createService({ templateStore });
        await service.initialize();
    });

    it('calls loadHelperFiles() on the template store', () => {
        assertEqual(1, templateStore.loadHelperFiles.callCount);
    });
});

describe('HyperviewService#initialize() with custom helper files', ({ before, it }) => {
    const customHelper = sinon.fake.returns('formatted');
    let templateStore;
    let templateEngine;

    before(async () => {
        templateStore = createMockTemplateStore({
            loadHelperFiles: sinon.fake.resolves([
                { name: 'customHelper', helper: customHelper },
            ]),
        });
        const pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(true),
            getPageTemplate: sinon.fake.resolves({ filename: 'page.html', source: '<p>test</p>' }),
        });
        templateEngine = createMockTemplateEngine();
        const service = createService({ templateStore, pageStore, templateEngine });
        await service.initialize();
        // Trigger a template compilation to observe what helpers were passed
        await service.getPageTemplate('/blog/post');
    });

    it('includes the custom helper in the helpers map passed to compileTemplate', () => {
        const helpers = templateEngine.compileTemplate.firstCall.args[2];
        assertEqual(customHelper, helpers.get('customHelper'));
    });

    it('preserves the built-in default helpers alongside custom helpers', () => {
        const helpers = templateEngine.compileTemplate.firstCall.args[2];
        assertFunction(helpers.get('formatDate'));
        assertFunction(helpers.get('markup'));
        assertFunction(helpers.get('truncate'));
    });
});

describe('HyperviewService#initialize() does not share helpers across instances', ({ before, it }) => {
    const customHelper = sinon.fake();

    before(async () => {
        const templateStoreA = createMockTemplateStore({
            loadHelperFiles: sinon.fake.resolves([{ name: 'customHelper', helper: customHelper }]),
        });
        const serviceA = createService({ templateStore: templateStoreA });
        await serviceA.initialize();
    });

    it('does not leak custom helpers from one instance to another', async () => {
        const templateEngine = createMockTemplateEngine();
        const pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(true),
            getPageTemplate: sinon.fake.resolves({ filename: 'page.html', source: '' }),
        });
        // Rebuild serviceB with a spy-able template engine to inspect what helpers it received
        const isolatedService = new HyperviewService({
            pageStore,
            templateStore: createMockTemplateStore(),
            templateEngine,
            staticFileServerStore: createMockStaticFileServerStore(),
        });
        await isolatedService.getPageTemplate('/blog/post');
        const helpers = templateEngine.compileTemplate.firstCall.args[2];
        assertEqual(false, helpers.has('customHelper'), 'customHelper should not be in a fresh instance');
    });
});


// --- getPageData() ---

describe('HyperviewService#getPageData() when page does not exist', ({ before, it }) => {
    let pageStore;
    let result;

    before(async () => {
        pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(false),
        });
        const service = createService({ pageStore });
        result = await service.getPageData(MOCK_REQUEST, MOCK_RESPONSE, '/missing');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });

    it('passes the pathname to doesPageExist()', () => {
        assertEqual('/missing', pageStore.doesPageExist.firstCall.firstArg);
    });

    it('does not call getPageData() on the store', () => {
        assertEqual(0, pageStore.getPageData.callCount);
    });
});

describe('HyperviewService#getPageData() when page exists', ({ before, it }) => {
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(true),
            getPageData: sinon.fake.resolves({ title: 'Test Page' }),
        });
        const service = createService({ pageStore });
        result = await service.getPageData(MOCK_REQUEST, MOCK_RESPONSE, '/blog/post');
    });

    it('returns a plain object', () => {
        assert(isPlainObject(result));
    });

    it('includes page data from the store', () => {
        assertEqual('Test Page', result.title);
    });

    it('hydrates canonicalURL from the request URL', () => {
        assertEqual('https://example.com/blog/post', result.canonicalURL);
    });

    it('hydrates href from the request URL', () => {
        assertEqual('https://example.com/blog/post', result.href);
    });

    it('hydrates openGraph.url from the canonical URL', () => {
        assertEqual('https://example.com/blog/post', result.openGraph.url);
    });

    it('hydrates openGraph.type as "website" by default', () => {
        assertEqual('website', result.openGraph.type);
    });
});

describe('HyperviewService#getPageData() merging response.props', ({ before, it }) => {
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(true),
            getPageData: sinon.fake.resolves({ title: 'Test Page' }),
        });
        const response = { props: { user: { name: 'Alice' } } };
        const service = createService({ pageStore });
        result = await service.getPageData(MOCK_REQUEST, response, '/blog/post');
    });

    it('merges response.props into the page data', () => {
        assert(isPlainObject(result.user));
        assertEqual('Alice', result.user.name);
    });

    it('preserves the original page data alongside merged props', () => {
        assertEqual('Test Page', result.title);
    });
});

describe('HyperviewService#getPageData() does not mutate the cached page object', ({ before, it }) => {
    let firstResult;
    let secondResult;

    before(async () => {
        const pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(true),
            getPageData: sinon.fake.resolves({ title: 'Test Page' }),
        });
        const service = createService({ pageStore });
        const responseA = { props: { extra: 'from-A' } };
        const responseB = { props: { extra: 'from-B' } };
        firstResult = await service.getPageData(MOCK_REQUEST, responseA, '/blog/post', { useCache: true });
        secondResult = await service.getPageData(MOCK_REQUEST, responseB, '/blog/post', { useCache: true });
    });

    it('first result has its own extra prop', () => {
        assertEqual('from-A', firstResult.extra);
    });

    it('second result has its own extra prop without contamination from first call', () => {
        assertEqual('from-B', secondResult.extra);
    });
});

describe('HyperviewService#getPageData() with warm cache and useCache=true', ({ before, it }) => {
    let pageStore;
    let result;

    before(async () => {
        pageStore = createMockPageStore({
            doesPageExist: sinon.fake.resolves(true),
            getPageData: sinon.fake.resolves({ title: 'Cached Page' }),
        });
        const service = createService({ pageStore });
        // First call warms the cache
        await service.getPageData(MOCK_REQUEST, MOCK_RESPONSE, '/blog/post');
        // Second call should hit the cache
        result = await service.getPageData(MOCK_REQUEST, MOCK_RESPONSE, '/blog/post', { useCache: true });
    });

    it('returns the page data', () => {
        assertEqual('Cached Page', result.title);
    });

    it('skips doesPageExist() filesystem check on cache hit', () => {
        assertEqual(1, pageStore.doesPageExist.callCount);
    });

    it('reads from the page store only once across both calls', () => {
        assertEqual(1, pageStore.getPageData.callCount);
    });
});


// --- getPageTemplate() ---

describe('HyperviewService#getPageTemplate() when template file is not found', ({ before, it }) => {
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            getPageTemplate: sinon.fake.resolves(null),
        });
        const service = createService({ pageStore });
        result = await service.getPageTemplate('/blog/post');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getPageTemplate() when template file is found', ({ before, it }) => {
    const mockRenderFn = sinon.fake.returns('<p>rendered</p>');
    let templateEngine;
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            getPageTemplate: sinon.fake.resolves({ filename: 'page.html', source: '<p>{{title}}</p>' }),
        });
        templateEngine = {
            compileTemplate: sinon.fake.returns(mockRenderFn),
        };
        const service = createService({ pageStore, templateEngine });
        result = await service.getPageTemplate('/blog/post');
    });

    it('returns the compiled template function', () => {
        assertEqual(mockRenderFn, result);
    });

    it('passes the template source to compileTemplate', () => {
        assertEqual('<p>{{title}}</p>', templateEngine.compileTemplate.firstCall.args[1]);
    });

    it('builds the template ID from pathname and filename', () => {
        assertEqual('/blog/post/page.html', templateEngine.compileTemplate.firstCall.args[0]);
    });
});

describe('HyperviewService#getPageTemplate() caches compiled templates', ({ before, it }) => {
    let pageStore;
    let templateEngine;

    before(async () => {
        pageStore = createMockPageStore({
            getPageTemplate: sinon.fake.resolves({ filename: 'page.html', source: '<p>test</p>' }),
        });
        templateEngine = createMockTemplateEngine();
        const service = createService({ pageStore, templateEngine });
        await service.getPageTemplate('/blog/post', { useCache: true });
        await service.getPageTemplate('/blog/post', { useCache: true });
    });

    it('reads the template file only once for repeated cache hits', () => {
        assertEqual(1, pageStore.getPageTemplate.callCount);
    });

    it('compiles the template only once for repeated cache hits', () => {
        // compileTemplate is called once for the page template (partials are empty)
        assertEqual(1, templateEngine.compileTemplate.callCount);
    });
});


// --- getPageMarkup() ---

describe('HyperviewService#getPageMarkup() when template is not found', ({ before, it }) => {
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            getPageTemplate: sinon.fake.resolves(null),
        });
        const service = createService({ pageStore });
        result = await service.getPageMarkup('/missing', {});
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getPageMarkup() when template is found', ({ before, it }) => {
    let result;

    before(async () => {
        // Template function renders pageData.title into markup
        const renderFn = (ctx) => `<p>${ ctx.title }</p>`;
        const pageStore = createMockPageStore({
            getPageTemplate: sinon.fake.resolves({ filename: 'page.html', source: '' }),
            getMarkdownContent: sinon.fake.resolves([]),
        });
        const templateEngine = { compileTemplate: sinon.fake.returns(renderFn) };
        const service = createService({ pageStore, templateEngine });
        result = await service.getPageMarkup('/blog/post', { title: 'Hello' });
    });

    it('returns the rendered markup string', () => {
        assertEqual('<p>Hello</p>', result);
    });
});


// --- getPageMarkdown() ---

describe('HyperviewService#getPageMarkdown() with no markdown files', ({ before, it }) => {
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            getMarkdownContent: sinon.fake.resolves([]),
        });
        const service = createService({ pageStore });
        result = await service.getPageMarkdown('/blog/post', {});
    });

    it('returns a plain object', () => {
        assert(isPlainObject(result));
    });

    it('returns an empty object', () => {
        assertEqual(0, Object.keys(result).length);
    });
});

describe('HyperviewService#getPageMarkdown() with markdown files', ({ before, it }) => {
    let result;

    before(async () => {
        const pageStore = createMockPageStore({
            getMarkdownContent: sinon.fake.resolves([
                { filename: 'body.md', source: '# Hello World' },
            ]),
        });
        // Template function passes the source through unchanged
        const templateEngine = {
            compileTemplate: sinon.fake.returns(() => '# Hello World'),
        };
        const service = createService({ pageStore, templateEngine });
        result = await service.getPageMarkdown('/blog/post', {});
    });

    it('keys content by filename without the .md extension', () => {
        assertEqual(true, Object.hasOwn(result, 'body'));
    });

    it('does not include the raw .md filename as a key', () => {
        assertEqual(false, Object.hasOwn(result, 'body.md'));
    });

    it('converts markdown source to HTML', () => {
        assertMatches('<h1>', result.body);
    });
});


// --- getBaseTemplate() ---

describe('HyperviewService#getBaseTemplate() when template is not found', ({ before, it }) => {
    let result;

    before(async () => {
        const templateStore = createMockTemplateStore({
            getBaseTemplate: sinon.fake.resolves(null),
        });
        const service = createService({ templateStore });
        result = await service.getBaseTemplate('layouts/base.html');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getBaseTemplate() when template is found', ({ before, it }) => {
    const mockRenderFn = sinon.fake.returns('<html>rendered</html>');
    let result;

    before(async () => {
        const templateStore = createMockTemplateStore({
            getBaseTemplate: sinon.fake.resolves({ filename: 'layouts/base.html', source: '<html>{{body}}</html>' }),
        });
        const templateEngine = { compileTemplate: sinon.fake.returns(mockRenderFn) };
        const service = createService({ templateStore, templateEngine });
        result = await service.getBaseTemplate('layouts/base.html');
    });

    it('returns the compiled template function', () => {
        assertEqual(mockRenderFn, result);
    });
});

describe('HyperviewService#getBaseTemplate() caches compiled templates', ({ before, it }) => {
    let templateStore;
    let templateEngine;

    before(async () => {
        templateStore = createMockTemplateStore({
            getBaseTemplate: sinon.fake.resolves({ filename: 'layouts/base.html', source: '<html>{{body}}</html>' }),
        });
        templateEngine = createMockTemplateEngine();
        const service = createService({ templateStore, templateEngine });
        await service.getBaseTemplate('layouts/base.html', { useCache: true });
        await service.getBaseTemplate('layouts/base.html', { useCache: true });
    });

    it('reads the template file only once for repeated cache hits', () => {
        assertEqual(1, templateStore.getBaseTemplate.callCount);
    });
});


// --- getStaticFile() ---

describe('HyperviewService#getStaticFile() when file exists', ({ before, it }) => {
    const mockFile = { sizeBytes: 512, contentType: 'image/png' };
    let result;

    before(async () => {
        const staticFileServerStore = createMockStaticFileServerStore({
            getFile: sinon.fake.resolves(mockFile),
        });
        const service = createService({ staticFileServerStore });
        result = await service.getStaticFile('/static/logo.png');
    });

    it('returns the file object from the store', () => {
        assertEqual(mockFile, result);
    });
});

describe('HyperviewService#getStaticFile() when file does not exist', ({ before, it }) => {
    let result;

    before(async () => {
        const staticFileServerStore = createMockStaticFileServerStore({
            getFile: sinon.fake.resolves(null),
        });
        const service = createService({ staticFileServerStore });
        result = await service.getStaticFile('/missing.png');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});
