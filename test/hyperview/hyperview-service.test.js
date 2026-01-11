import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, isPlainObject } from 'kixx-assert';

import HyperviewService from '../../lib/hyperview/hyperview-service.js';
import * as markedModule from '../../lib/vendor/marked/mod.js';


describe('HyperviewService#getPageData() when page does not exist', ({ before, after, it }) => {
    const pageStore = {
        doesPageExist: sinon.stub().resolves(false),
        getPageData: sinon.stub(),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub(),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post?foo=bar',
        },
    };

    const response = {
        props: {},
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls doesPageExist() on pageStore', () => {
        assertEqual(1, pageStore.doesPageExist.callCount);
        assertEqual('/blog/post', pageStore.doesPageExist.getCall(0).firstArg);
    });

    it('does not call getPageData() on pageStore', () => {
        assertEqual(0, pageStore.getPageData.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getPageData() when page exists and useCache is false', ({ before, after, it }) => {
    const pageData = {
        title: 'My Blog Post',
        description: 'A great post',
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post?foo=bar',
        },
    };

    const response = {
        props: { customProp: 'value' },
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls doesPageExist() on pageStore', () => {
        assertEqual(1, pageStore.doesPageExist.callCount);
        assertEqual('/blog/post', pageStore.doesPageExist.getCall(0).firstArg);
    });

    it('calls getPageData() on pageStore', () => {
        assertEqual(1, pageStore.getPageData.callCount);
        assertEqual('/blog/post', pageStore.getPageData.getCall(0).firstArg);
    });

    it('returns a page object', () => {
        assert(isPlainObject(result));
    });

    it('merges response.props into page data', () => {
        assertEqual('value', result.customProp);
    });

    it('preserves original page data properties', () => {
        assertEqual('My Blog Post', result.title);
        assertEqual('A great post', result.description);
    });

    it('sets canonicalURL from request URL', () => {
        assertEqual('https://example.com/blog/post', result.canonicalURL);
    });

    it('sets href from request URL', () => {
        assertEqual('https://example.com/blog/post?foo=bar', result.href);
    });

    it('creates openGraph object', () => {
        assert(isPlainObject(result.openGraph));
    });

    it('sets openGraph.url to canonicalURL', () => {
        assertEqual('https://example.com/blog/post', result.openGraph.url);
    });

    it('sets openGraph.type to website', () => {
        assertEqual('website', result.openGraph.type);
    });

    it('sets openGraph.title from page title', () => {
        assertEqual('My Blog Post', result.openGraph.title);
    });

    it('sets openGraph.description from page description', () => {
        assertEqual('A great post', result.openGraph.description);
    });
});

describe('HyperviewService#getPageData() when page exists and useCache is true and cache is empty', ({ before, after, it }) => {
    const pageData = {
        title: 'Cached Post',
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/cached',
            href: 'https://example.com/blog/cached',
        },
    };

    const response = {
        props: {},
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/cached', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('calls doesPageExist() on pageStore', () => {
        assertEqual(1, pageStore.doesPageExist.callCount);
    });

    it('calls getPageData() on pageStore', () => {
        assertEqual(1, pageStore.getPageData.callCount);
    });

    it('returns a page object', () => {
        assert(isPlainObject(result));
    });
});

describe('HyperviewService#getPageData() when page exists and useCache is true and cache has data', ({ before, after, it }) => {
    const cachedPageData = {
        title: 'Cached Title',
        description: 'Cached Description',
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(cachedPageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/cached',
            href: 'https://example.com/blog/cached',
        },
    };

    const response = {
        props: {},
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        // First call to populate cache
        await service.getPageData(request, response, '/blog/cached', { useCache: false });

        // Reset call counts
        pageStore.doesPageExist.resetHistory();
        pageStore.getPageData.resetHistory();

        // Second call with useCache=true
        result = await service.getPageData(request, response, '/blog/cached', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('does not call doesPageExist() on pageStore when cache has data', () => {
        assertEqual(0, pageStore.doesPageExist.callCount);
    });

    it('does not call getPageData() on pageStore when cache has data', () => {
        assertEqual(0, pageStore.getPageData.callCount);
    });

    it('returns cached page data', () => {
        assertEqual('Cached Title', result.title);
        assertEqual('Cached Description', result.description);
    });

    it('hydrates cached data with request URL', () => {
        assertEqual('https://example.com/blog/cached', result.canonicalURL);
        assertEqual('https://example.com/blog/cached', result.href);
    });
});

describe('HyperviewService#getPageData() when page exists and response.props overrides page data', ({ before, after, it }) => {
    const pageData = {
        title: 'Original Title',
        description: 'Original Description',
        customField: 'original',
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post',
        },
    };

    const response = {
        props: {
            title: 'Overridden Title',
            newField: 'new value',
        },
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('overrides page data with response.props', () => {
        assertEqual('Overridden Title', result.title);
    });

    it('preserves page data fields not in response.props', () => {
        assertEqual('Original Description', result.description);
        assertEqual('original', result.customField);
    });

    it('adds new fields from response.props', () => {
        assertEqual('new value', result.newField);
    });
});

describe('HyperviewService#getPageData() when page data has existing canonicalURL and href', ({ before, after, it }) => {
    const pageData = {
        canonicalURL: 'https://example.com/custom-canonical',
        href: 'https://example.com/custom-href',
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post',
        },
    };

    const response = {
        props: {},
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('preserves existing canonicalURL', () => {
        assertEqual('https://example.com/custom-canonical', result.canonicalURL);
    });

    it('preserves existing href', () => {
        assertEqual('https://example.com/custom-href', result.href);
    });
});

describe('HyperviewService#getPageData() when page data has existing openGraph properties', ({ before, after, it }) => {
    const pageData = {
        title: 'Page Title',
        description: 'Page Description',
        openGraph: {
            url: 'https://example.com/custom-og-url',
            type: 'article',
            title: 'Custom OG Title',
        },
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post',
        },
    };

    const response = {
        props: {},
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('preserves existing openGraph.url', () => {
        assertEqual('https://example.com/custom-og-url', result.openGraph.url);
    });

    it('preserves existing openGraph.type', () => {
        assertEqual('article', result.openGraph.type);
    });

    it('preserves existing openGraph.title', () => {
        assertEqual('Custom OG Title', result.openGraph.title);
    });

    it('fills missing openGraph.description from page description', () => {
        assertEqual('Page Description', result.openGraph.description);
    });
});

describe('HyperviewService#getPageData() when page data has title with template syntax', ({ before, after, it }) => {
    const pageData = {
        title: '{{ siteName }} - {{ pageTitle }}',
        siteName: 'My Site',
        pageTitle: 'Blog Post',
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            return (props) => {
                return source.replace(/\{\{ siteName \}\}/g, props.siteName)
                    .replace(/\{\{ pageTitle \}\}/g, props.pageTitle);
            };
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post',
        },
    };

    const response = {
        props: {},
    };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageData(request, response, '/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('renders title template with page data', () => {
        assertEqual('My Site - Blog Post', result.title);
    });

    it('sets openGraph.title to rendered title', () => {
        assertEqual('My Site - Blog Post', result.openGraph.title);
    });
});

describe('HyperviewService#getPageData() when cached page data is not mutated by response.props', ({ before, after, it }) => {
    const pageData = {
        title: 'Original Title',
        count: 0,
    };

    const pageStore = {
        doesPageExist: sinon.stub().resolves(true),
        getPageData: sinon.stub().resolves(pageData),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const request = {
        url: {
            protocol: 'https:',
            host: 'example.com',
            pathname: '/blog/post',
            href: 'https://example.com/blog/post',
        },
    };

    const response1 = {
        props: { count: 1 },
    };

    const response2 = {
        props: { count: 2 },
    };

    let result1;
    let result2;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        // First call
        result1 = await service.getPageData(request, response1, '/blog/post', { useCache: false });

        // Second call with different response.props
        result2 = await service.getPageData(request, response2, '/blog/post', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('first result has count from first response.props', () => {
        assertEqual(1, result1.count);
    });

    it('second result has count from second response.props', () => {
        assertEqual(2, result2.count);
    });

    it('cached pageData is not mutated', () => {
        assertEqual(0, pageData.count);
        assertEqual('Original Title', pageData.title);
    });
});

describe('HyperviewService#getPageTemplate() when template does not exist', ({ before, after, it }) => {
    const pageStore = {
        getPageTemplate: sinon.stub().resolves(null),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub(),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageTemplate('/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getPageTemplate() on pageStore', () => {
        assertEqual(1, pageStore.getPageTemplate.callCount);
        assertEqual('/blog/post', pageStore.getPageTemplate.getCall(0).firstArg);
    });

    it('does not call compileTemplate() on templateEngine', () => {
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getPageTemplate() when template exists and useCache is false', ({ before, after, it }) => {
    const templateFile = {
        filename: 'page.html',
        source: '<h1>{{ title }}</h1>',
    };

    const compiledTemplate = sinon.stub().returns('<h1>Rendered Title</h1>');

    const pageStore = {
        getPageTemplate: sinon.stub().resolves(templateFile),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageTemplate('/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getPageTemplate() on pageStore', () => {
        assertEqual(1, pageStore.getPageTemplate.callCount);
        assertEqual('/blog/post', pageStore.getPageTemplate.getCall(0).firstArg);
    });

    it('calls loadPartialFiles() on templateStore', () => {
        assertEqual(1, templateStore.loadPartialFiles.callCount);
    });

    it('calls compileTemplate() on templateEngine', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
        assertEqual('/blog/post/page.html', templateEngine.compileTemplate.getCall(0).args[0]);
        assertEqual('<h1>{{ title }}</h1>', templateEngine.compileTemplate.getCall(0).args[1]);
    });

    it('returns a function', () => {
        assert(typeof result === 'function');
    });

    it('returns a template function that can be rendered', () => {
        const output = result({ title: 'Test Title' });
        assertEqual('<h1>Rendered Title</h1>', output);
        assertEqual(1, compiledTemplate.callCount);
    });
});

describe('HyperviewService#getPageTemplate() when template exists and useCache is true and cache is empty', ({ before, after, it }) => {
    const templateFile = {
        filename: 'page.html',
        source: '<div>{{ content }}</div>',
    };

    const compiledTemplate = sinon.stub().returns('<div>Rendered</div>');

    const pageStore = {
        getPageTemplate: sinon.stub().resolves(templateFile),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageTemplate('/blog/cached', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getPageTemplate() on pageStore', () => {
        assertEqual(1, pageStore.getPageTemplate.callCount);
    });

    it('calls compileTemplate() on templateEngine', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
    });

    it('returns a function', () => {
        assert(typeof result === 'function');
    });
});

describe('HyperviewService#getPageTemplate() when template exists and useCache is true and cache has template', ({ before, after, it }) => {
    const templateFile = {
        filename: 'page.html',
        source: '<h1>{{ title }}</h1>',
    };

    const cachedTemplate = sinon.stub().returns('<h1>Cached</h1>');
    const freshTemplate = sinon.stub().returns('<h1>Fresh</h1>');

    const pageStore = {
        getPageTemplate: sinon.stub().resolves(templateFile),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().returns(cachedTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        // First call with useCache=true to populate cache
        await service.getPageTemplate('/blog/cached', { useCache: true });

        // Reset call counts
        pageStore.getPageTemplate.resetHistory();
        templateStore.loadPartialFiles.resetHistory();
        templateEngine.compileTemplate.resetHistory();

        // Change templateEngine to return different template to verify cache is used
        templateEngine.compileTemplate.returns(freshTemplate);

        // Second call with useCache=true - should use cache
        result = await service.getPageTemplate('/blog/cached', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getPageTemplate() on pageStore when cache has template', () => {
        assertEqual(0, pageStore.getPageTemplate.callCount);
    });

    it('does not call loadPartialFiles() on templateStore when cache has template', () => {
        assertEqual(0, templateStore.loadPartialFiles.callCount);
    });

    it('does not call compileTemplate() on templateEngine when cache has template', () => {
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('returns cached template function', () => {
        assert(typeof result === 'function');
        const output = result({});
        assertEqual('<h1>Cached</h1>', output);
    });
});

describe('HyperviewService#getPageTemplate() when template exists and useCache is false', ({ before, after, it }) => {
    const templateFile = {
        filename: 'page.html',
        source: '<h1>{{ title }}</h1>',
    };

    const compiledTemplate = sinon.stub().returns('<h1>Fresh</h1>');

    const pageStore = {
        getPageTemplate: sinon.stub().resolves(templateFile),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        // First call with useCache=false (does not cache)
        await service.getPageTemplate('/blog/post', { useCache: false });

        // Reset call counts
        pageStore.getPageTemplate.resetHistory();
        templateStore.loadPartialFiles.resetHistory();
        templateEngine.compileTemplate.resetHistory();

        // Second call with useCache=false - should still load from filesystem
        // (cache is not used when useCache is false, and template is not cached when useCache is false)
        result = await service.getPageTemplate('/blog/post', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getPageTemplate() on pageStore on every call when useCache is false', () => {
        assertEqual(1, pageStore.getPageTemplate.callCount);
    });

    it('calls compileTemplate() on templateEngine on every call when useCache is false', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
    });

    it('returns template function', () => {
        assert(typeof result === 'function');
        const output = result({});
        assertEqual('<h1>Fresh</h1>', output);
    });
});

describe('HyperviewService#getPageTemplate() with XML template file', ({ before, after, it }) => {
    const templateFile = {
        filename: 'page.xml',
        source: '<?xml version="1.0"?><sitemap>{{ content }}</sitemap>',
    };

    const compiledTemplate = sinon.stub().returns('<?xml version="1.0"?><sitemap>Content</sitemap>');

    const pageStore = {
        getPageTemplate: sinon.stub().resolves(templateFile),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageTemplate('/sitemap', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getPageTemplate() on pageStore', () => {
        assertEqual(1, pageStore.getPageTemplate.callCount);
        assertEqual('/sitemap', pageStore.getPageTemplate.getCall(0).firstArg);
    });

    it('calls compileTemplate() with correct templateId including filename', () => {
        assertEqual('/sitemap/page.xml', templateEngine.compileTemplate.getCall(0).args[0]);
    });

    it('returns a function', () => {
        assert(typeof result === 'function');
    });
});

describe('HyperviewService#getPageMarkdown() when no markdown files exist', ({ before, after, it }) => {
    const pageStore = {
        getMarkdownContent: sinon.stub().resolves([]),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub(),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const pageData = { title: 'Test' };

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageMarkdown('/blog/post', pageData, { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getMarkdownContent() on pageStore', () => {
        assertEqual(1, pageStore.getMarkdownContent.callCount);
        assertEqual('/blog/post', pageStore.getMarkdownContent.getCall(0).firstArg);
    });

    it('does not call compileTemplate() on templateEngine', () => {
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
        assertEqual(0, Object.keys(result).length);
    });
});

describe('HyperviewService#getPageMarkdown() when single markdown file exists', ({ before, after, it }) => {
    const markdownFiles = [
        {
            filename: 'body.md',
            source: '# Introduction\n\nThis is the body.',
        },
    ];

    const pageStore = {
        getMarkdownContent: sinon.stub().resolves(markdownFiles),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const pageData = { title: 'Test' };

    let markedParseStub;
    let result;

    before(async () => {
        markedParseStub = sinon.stub(markedModule.marked, 'parse').returns('<h1>Introduction</h1>\n<p>This is the body.</p>');

        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageMarkdown('/blog/post', pageData, { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getMarkdownContent() on pageStore', () => {
        assertEqual(1, pageStore.getMarkdownContent.callCount);
    });

    it('calls compileTemplate() for each markdown file', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
        assertEqual('/blog/post/body.md', templateEngine.compileTemplate.getCall(0).args[0]);
        assertEqual('# Introduction\n\nThis is the body.', templateEngine.compileTemplate.getCall(0).args[1]);
    });

    it('renders template with pageData', () => {
        // Template is rendered in getPageMarkdown, verified by marked.parse being called
        assertEqual(1, markedParseStub.callCount);
    });

    it('calls marked.parse() with rendered markdown', () => {
        assertEqual(1, markedParseStub.callCount);
        assertEqual('# Introduction\n\nThis is the body.', markedParseStub.getCall(0).firstArg);
    });

    it('returns content object with key from filename without .md extension', () => {
        assert(isPlainObject(result));
        assertEqual('body', Object.keys(result)[0]);
    });

    it('returns parsed HTML for markdown content', () => {
        assertEqual('<h1>Introduction</h1>\n<p>This is the body.</p>', result.body);
    });
});

describe('HyperviewService#getPageMarkdown() when multiple markdown files exist', ({ before, after, it }) => {
    const markdownFiles = [
        {
            filename: 'intro.md',
            source: '# Introduction',
        },
        {
            filename: 'body.md',
            source: 'Body content here.',
        },
        {
            filename: 'footer.md',
            source: 'Footer content.',
        },
    ];

    const pageStore = {
        getMarkdownContent: sinon.stub().resolves(markdownFiles),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source as-is (no template syntax processing needed for this test)
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const pageData = { title: 'Test' };

    let markedParseStub;
    let result;

    before(async () => {
        markedParseStub = sinon.stub(markedModule.marked, 'parse')
            .onCall(0).returns('<h1>Introduction</h1>')
            .onCall(1).returns('<p>Body content here.</p>')
            .onCall(2).returns('<p>Footer content.</p>');

        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageMarkdown('/blog/post', pageData, { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls compileTemplate() for each markdown file', () => {
        assertEqual(3, templateEngine.compileTemplate.callCount);
    });

    it('renders each template with pageData', () => {
        // Templates are rendered in the getPageMarkdown method
        assertEqual(3, markedParseStub.callCount);
    });

    it('calls marked.parse() for each rendered markdown', () => {
        assertEqual(3, markedParseStub.callCount);
    });

    it('returns content object with keys from filenames without .md extension', () => {
        assert(isPlainObject(result));
        assertEqual(3, Object.keys(result).length);
        assert('intro' in result);
        assert('body' in result);
        assert('footer' in result);
    });

    it('returns parsed HTML for all markdown content', () => {
        assertEqual('<h1>Introduction</h1>', result.intro);
        assertEqual('<p>Body content here.</p>', result.body);
        assertEqual('<p>Footer content.</p>', result.footer);
    });
});

describe('HyperviewService#getPageMarkdown() when markdown contains template syntax', ({ before, after, it }) => {
    const markdownFiles = [
        {
            filename: 'body.md',
            source: '# {{ title }}\n\nPublished on {{ date }}',
        },
    ];

    const pageStore = {
        getMarkdownContent: sinon.stub().resolves(markdownFiles),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that processes template syntax
            return (props) => {
                return source
                    .replace(/\{\{ title \}\}/g, props.title)
                    .replace(/\{\{ date \}\}/g, props.date);
            };
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const pageData = {
        title: 'My Post',
        date: '2024-01-01',
    };

    let markedParseStub;
    let result;

    before(async () => {
        markedParseStub = sinon.stub(markedModule.marked, 'parse').returns('<h1>My Post</h1>\n<p>Published on 2024-01-01</p>');

        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageMarkdown('/blog/post', pageData, { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('renders template syntax in markdown with pageData', () => {
        // Template syntax is rendered, verified by marked.parse receiving rendered markdown
        assertEqual(1, markedParseStub.callCount);
        assertEqual('# My Post\n\nPublished on 2024-01-01', markedParseStub.getCall(0).firstArg);
    });

    it('parses rendered markdown to HTML', () => {
        assertEqual(1, markedParseStub.callCount);
        assertEqual('# My Post\n\nPublished on 2024-01-01', markedParseStub.getCall(0).firstArg);
    });

    it('returns parsed HTML with template values', () => {
        assertEqual('<h1>My Post</h1>\n<p>Published on 2024-01-01</p>', result.body);
    });
});

describe('HyperviewService#getPageMarkdown() when useCache is true and cache is empty', ({ before, after, it }) => {
    const markdownFiles = [
        {
            filename: 'body.md',
            source: '# Content',
        },
    ];

    const pageStore = {
        getMarkdownContent: sinon.stub().resolves(markdownFiles),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const pageData = { title: 'Test' };

    let markedParseStub;
    let result;

    before(async () => {
        markedParseStub = sinon.stub(markedModule.marked, 'parse').returns('<h1>Content</h1>');

        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getPageMarkdown('/blog/cached', pageData, { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getMarkdownContent() on pageStore', () => {
        assertEqual(1, pageStore.getMarkdownContent.callCount);
    });

    it('calls compileTemplate() on templateEngine', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
    });

    it('calls marked.parse() with markdown source', () => {
        assertEqual(1, markedParseStub.callCount);
        assertEqual('# Content', markedParseStub.getCall(0).firstArg);
    });

    it('returns content object', () => {
        assert(isPlainObject(result));
    });
});

describe('HyperviewService#getPageMarkdown() when useCache is true and cache has templates', ({ before, after, it }) => {
    const markdownFiles = [
        {
            filename: 'body.md',
            source: '# Cached Content',
        },
    ];

    const pageStore = {
        getMarkdownContent: sinon.stub().resolves(markdownFiles),
    };

    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };

    const templateEngine = {
        compileTemplate: sinon.stub().callsFake((templateId, source) => {
            // Return a function that returns the source
            return () => source;
        }),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    const pageData = { title: 'Test' };

    let markedParseStub;
    let result;

    before(async () => {
        markedParseStub = sinon.stub(markedModule.marked, 'parse').returns('<h1>Cached Content</h1>');

        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        // First call with useCache=true to populate cache
        await service.getPageMarkdown('/blog/cached', pageData, { useCache: true });

        // Reset call counts
        pageStore.getMarkdownContent.resetHistory();
        templateStore.loadPartialFiles.resetHistory();
        templateEngine.compileTemplate.resetHistory();

        // Second call with useCache=true - should use cache
        result = await service.getPageMarkdown('/blog/cached', pageData, { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getMarkdownContent() on pageStore when cache has templates', () => {
        assertEqual(0, pageStore.getMarkdownContent.callCount);
    });

    it('does not call compileTemplate() on templateEngine when cache has templates', () => {
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('uses cached template function', () => {
        // Cache is used, verified by getMarkdownContent and compileTemplate not being called
        assertEqual(0, pageStore.getMarkdownContent.callCount);
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('calls marked.parse() with cached template output', () => {
        assertEqual(2, markedParseStub.callCount);
        assertEqual('# Cached Content', markedParseStub.getCall(1).firstArg);
    });

    it('returns content from cached template', () => {
        assertEqual('<h1>Cached Content</h1>', result.body);
    });
});

describe('HyperviewService#getBaseTemplate() when template does not exist', ({ before, after, it }) => {
    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
        getBaseTemplate: sinon.stub().resolves(null),
    };
    const templateEngine = {
        compileTemplate: sinon.stub(),
    };
    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getBaseTemplate('layouts/missing.html', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getBaseTemplate() on templateStore', () => {
        assertEqual(1, templateStore.getBaseTemplate.callCount);
        assertEqual('layouts/missing.html', templateStore.getBaseTemplate.getCall(0).firstArg);
    });

    it('does not call compileTemplate() on templateEngine', () => {
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getBaseTemplate() when template exists', ({ before, after, it }) => {
    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
        getBaseTemplate: sinon.stub().resolves({
            filename: 'layouts/base.html',
            source: '<html><body>{{> content}}</body></html>',
        }),
    };

    const compiledTemplate = sinon.stub().returns('<html><body>Content</body></html>');
    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getBaseTemplate('layouts/base.html', { useCache: false });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getBaseTemplate() on templateStore', () => {
        assertEqual(1, templateStore.getBaseTemplate.callCount);
        assertEqual('layouts/base.html', templateStore.getBaseTemplate.getCall(0).firstArg);
    });

    it('calls loadPartialFiles() on templateStore', () => {
        assertEqual(1, templateStore.loadPartialFiles.callCount);
    });

    it('calls compileTemplate() on templateEngine', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
        assertEqual('layouts/base.html', templateEngine.compileTemplate.getCall(0).args[0]);
        assertEqual('<html><body>{{> content}}</body></html>', templateEngine.compileTemplate.getCall(0).args[1]);
    });

    it('returns a function', () => {
        assert(typeof result === 'function');
    });
});

describe('HyperviewService#getBaseTemplate() when useCache is true and cache is empty', ({ before, after, it }) => {
    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
        getBaseTemplate: sinon.stub().resolves({
            filename: 'layouts/base.html',
            source: '<html><body>Content</body></html>',
        }),
    };

    const compiledTemplate = sinon.stub().returns('<html><body>Content</body></html>');
    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getBaseTemplate('layouts/base.html', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('calls getBaseTemplate() on templateStore', () => {
        assertEqual(1, templateStore.getBaseTemplate.callCount);
    });

    it('calls compileTemplate() on templateEngine', () => {
        assertEqual(1, templateEngine.compileTemplate.callCount);
    });

    it('returns a function', () => {
        assert(typeof result === 'function');
    });
});

describe('HyperviewService#getBaseTemplate() when useCache is true and cache has template', ({ before, after, it }) => {
    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
        getBaseTemplate: sinon.stub().resolves({
            filename: 'layouts/base.html',
            source: '<html><body>Cached Content</body></html>',
        }),
    };

    const cachedTemplate = sinon.stub().returns('<html><body>Cached Content</body></html>');
    const freshTemplate = sinon.stub().returns('<html><body>Fresh Content</body></html>');

    const templateEngine = {
        compileTemplate: sinon.stub().returns(cachedTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        // First call with useCache=true to populate cache
        await service.getBaseTemplate('layouts/base.html', { useCache: true });

        // Reset call counts
        templateStore.getBaseTemplate.resetHistory();
        templateStore.loadPartialFiles.resetHistory();
        templateEngine.compileTemplate.resetHistory();
        cachedTemplate.resetHistory();

        // Change templateEngine to return different template to verify cache is used
        templateEngine.compileTemplate.returns(freshTemplate);

        // Second call with useCache=true - should use cache
        result = await service.getBaseTemplate('layouts/base.html', { useCache: true });
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getBaseTemplate() on templateStore when cache has template', () => {
        assertEqual(0, templateStore.getBaseTemplate.callCount);
    });

    it('does not call compileTemplate() on templateEngine when cache has template', () => {
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('uses cached template function', () => {
        // Cache is used, verified by getBaseTemplate and compileTemplate not being called
        assertEqual(0, templateStore.getBaseTemplate.callCount);
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('returns cached template function', () => {
        assert(typeof result === 'function');
        assertEqual(cachedTemplate, result);
    });
});

describe('HyperviewService#getBaseTemplate() when useCache is false', ({ before, after, it }) => {
    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
        getBaseTemplate: sinon.stub().resolves({
            filename: 'layouts/base.html',
            source: '<html><body>Content</body></html>',
        }),
    };

    const compiledTemplate = sinon.stub().returns('<html><body>Content</body></html>');
    const templateEngine = {
        compileTemplate: sinon.stub().returns(compiledTemplate),
    };

    const staticFileServerStore = {};

    const service = new HyperviewService();

    let result;
    let firstCallCount;
    let secondCallCount;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getBaseTemplate('layouts/base.html', { useCache: false });
        firstCallCount = templateStore.getBaseTemplate.callCount;

        // Reset call counts and make a second call to verify it's not cached
        templateStore.getBaseTemplate.resetHistory();
        templateStore.loadPartialFiles.resetHistory();
        templateEngine.compileTemplate.resetHistory();

        await service.getBaseTemplate('layouts/base.html', { useCache: false });
        secondCallCount = templateStore.getBaseTemplate.callCount;
    });

    after(() => {
        sinon.restore();
    });

    it('calls getBaseTemplate() on templateStore for first call', () => {
        assertEqual(1, firstCallCount);
    });

    it('calls getBaseTemplate() again on second call when useCache is false', () => {
        // Second call should also call getBaseTemplate (not cached)
        assertEqual(1, secondCallCount);
    });

    it('returns a function', () => {
        assert(typeof result === 'function');
    });
});

describe('HyperviewService#getStaticFile() when file does not exist', ({ before, after, it }) => {
    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };
    const templateEngine = {};
    const staticFileServerStore = {
        getFile: sinon.stub().resolves(null),
    };

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getStaticFile('/static/css/style.css');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFile() on staticFileServerStore', () => {
        assertEqual(1, staticFileServerStore.getFile.callCount);
        assertEqual('/static/css/style.css', staticFileServerStore.getFile.getCall(0).firstArg);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('HyperviewService#getStaticFile() when file exists', ({ before, after, it }) => {
    const mockFile = {
        filepath: '/path/to/public/static/css/style.css',
        modifiedDate: new Date('2024-01-01T00:00:00Z'),
        computeEtag: sinon.stub().resolves('abc123'),
        createReadStream: sinon.stub(),
    };

    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };
    const templateEngine = {};
    const staticFileServerStore = {
        getFile: sinon.stub().resolves(mockFile),
    };

    const service = new HyperviewService();

    let result;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result = await service.getStaticFile('/static/css/style.css');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFile() on staticFileServerStore', () => {
        assertEqual(1, staticFileServerStore.getFile.callCount);
        assertEqual('/static/css/style.css', staticFileServerStore.getFile.getCall(0).firstArg);
    });

    it('returns the file object', () => {
        assertEqual(mockFile, result);
    });
});

describe('HyperviewService#getStaticFile() with different pathnames', ({ before, after, it }) => {
    const mockFile1 = { filepath: '/path/to/public/images/logo.png' };
    const mockFile2 = { filepath: '/path/to/public/js/app.js' };

    const pageStore = {};
    const templateStore = {
        loadHelperFiles: sinon.stub().resolves([]),
        loadPartialFiles: sinon.stub().resolves([]),
    };
    const templateEngine = {};
    const staticFileServerStore = {
        getFile: sinon.stub()
            .onCall(0).resolves(mockFile1)
            .onCall(1).resolves(mockFile2),
    };

    const service = new HyperviewService();

    let result1;
    let result2;

    before(async () => {
        await service.initialize({
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        });

        result1 = await service.getStaticFile('/images/logo.png');
        result2 = await service.getStaticFile('/js/app.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFile() for each pathname', () => {
        assertEqual(2, staticFileServerStore.getFile.callCount);
        assertEqual('/images/logo.png', staticFileServerStore.getFile.getCall(0).firstArg);
        assertEqual('/js/app.js', staticFileServerStore.getFile.getCall(1).firstArg);
    });

    it('returns the correct file for each pathname', () => {
        assertEqual(mockFile1, result1);
        assertEqual(mockFile2, result2);
    });
});

