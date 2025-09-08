import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual,
    assertUndefined
} from 'kixx-assert';
import ViewService from '../../lib/view-service/view-service.js';

const MOCK_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('ViewService#constructor with valid options', ({ before, it }) => {
    let subject;
    const options = {
        logger: { warn: sinon.stub() },
        pageDirectory: path.join(MOCK_DIR, 'pages'),
        templatesDirectory: path.join(MOCK_DIR, 'templates'),
        partialsDirectory: path.join(MOCK_DIR, 'partials'),
        helpersDirectory: path.join(MOCK_DIR, 'helpers'),
    };

    before(() => {
        subject = new ViewService(options);
    });

    it('should initialize with provided options', () => {
        assert(subject);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), subject.filepathForPagePath('/about', 'page.html'));
        assertEqual(path.join(MOCK_DIR, 'templates', 'base.html'), subject.filepathForTemplate('base.html'));
    });
});

describe('ViewService#constructor with missing required options', ({ it }) => {
    it('should throw AssertionError when pageDirectory is missing', () => {
        let error;
        try {
            new ViewService({
                logger: { warn: sinon.stub() },
                templatesDirectory: path.join(MOCK_DIR, 'templates'),
                partialsDirectory: path.join(MOCK_DIR, 'partials'),
                helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw AssertionError when templatesDirectory is missing', () => {
        let error;
        try {
            new ViewService({
                logger: { warn: sinon.stub() },
                pageDirectory: path.join(MOCK_DIR, 'pages'),
                partialsDirectory: path.join(MOCK_DIR, 'partials'),
                helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw AssertionError when partialsDirectory is missing', () => {
        let error;
        try {
            new ViewService({
                logger: { warn: sinon.stub() },
                pageDirectory: path.join(MOCK_DIR, 'pages'),
                templatesDirectory: path.join(MOCK_DIR, 'templates'),
                helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw AssertionError when helpersDirectory is missing', () => {
        let error;
        try {
            new ViewService({
                logger: { warn: sinon.stub() },
                pageDirectory: path.join(MOCK_DIR, 'pages'),
                templatesDirectory: path.join(MOCK_DIR, 'templates'),
                partialsDirectory: path.join(MOCK_DIR, 'partials'),
            });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('ViewService#initialize', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
            createMetadataTemplate: sinon.stub(),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        await subject.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('should initialize the template engine', () => {
        assertEqual(1, mockTemplateEngine.initialize.callCount);
    });
});

describe('ViewService#getPageData with valid data files', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let result;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
            createMetadataTemplate: sinon.stub(),
        };

        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves('{"siteTitle": "My Site", "baseTemplateId": "base.html"}')
                .onSecondCall().resolves('{"pageTitle": "About Us", "content": "About content"}'),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageData('/about', { customProp: 'value' });
    });

    after(() => {
        sinon.restore();
    });

    it('should read site page data file', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'page.jsonc'), mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should read page-specific data file', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.jsonc'), mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should merge data in correct priority order', () => {
        assertEqual('My Site', result.siteTitle);
        assertEqual('About Us', result.pageTitle);
        assertEqual('About content', result.content);
        assertEqual('value', result.customProp);
        assertEqual('base.html', result.baseTemplateId);
    });
});

describe('ViewService#getPageData with missing page data file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let result;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
            createMetadataTemplate: sinon.stub(),
        };

        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves('{"siteTitle": "My Site"}')
                .onSecondCall().resolves(null), // Page data file doesn't exist
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageData('/about');
    });

    after(() => {
        sinon.restore();
    });

    it('should return only site data when page data is missing', () => {
        assertEqual('My Site', result.siteTitle);
        assertEqual(undefined, result.pageTitle);
    });
});

describe('ViewService#getPageData with file read error on first file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let error;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
            createMetadataTemplate: sinon.stub(),
        };

        const readError = new Error('Permission denied');
        readError.code = 'EACCES';

        mockFileSystem = {
            readUtf8File: sinon.stub().rejects(readError),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();

        try {
            await subject.getPageData('/about');
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('should throw WrappedError with cause', () => {
        assert(error);
        assertEqual('WrappedError', error.name);
        assertEqual('EACCES', error.cause.code);
    });
});

describe('ViewService#getPageData with file read error on second file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let error;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
            createMetadataTemplate: sinon.stub(),
        };

        const readError = new Error('Permission denied');
        readError.code = 'EACCES';

        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves('{"siteTitle": "My Site"}')
                .onSecondCall().rejects(readError),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();

        try {
            await subject.getPageData('/about');
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('should throw WrappedError with cause', () => {
        assert(error);
        assertEqual('WrappedError', error.name);
        assertEqual('EACCES', error.cause.code);
    });
});

describe('ViewService#getPageMarkup with template and markdown', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockMarkdown;
    let mockTemplate;
    let result;
    const templateContext = { title: 'About' };

    before(async () => {
        mockTemplate = sinon.stub().returns('<html><body><p>content</p></body></html>');
        mockMarkdown = sinon.stub().returns('markdown content');

        const fileSystem = {
            readDirectory: sinon.stub().resolves([
                {
                    name: 'page-block-1.md',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'page-block-2.md',
                    isFile: sinon.stub().returns(true),
                },
            ]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub()
                .onFirstCall().resolves(mockMarkdown)
                .onSecondCall().resolves(mockMarkdown)
                .onThirdCall().resolves(mockTemplate),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkup('/about', templateContext);
    });

    after(() => {
        sinon.restore();
    });

    it('should request markdown template', () => {
        assertEqual(3, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/page-block-1.md', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual('about/page-block-2.md', mockTemplateEngine.getTemplate.getCall(1).args[0]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page-block-1.md'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page-block-2.md'), mockTemplateEngine.getTemplate.getCall(1).args[1]);
    });

    it('should request html template', () => {
        assertEqual(3, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/page.html', mockTemplateEngine.getTemplate.getCall(2).args[0]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), mockTemplateEngine.getTemplate.getCall(2).args[1]);
    });

    it('should render template with content', () => {
        assertEqual(2, mockMarkdown.callCount);
        assertEqual('About', mockMarkdown.getCall(0).args[0].title);
        assertEqual('About', mockMarkdown.getCall(1).args[0].title);
        assertUndefined(mockMarkdown.getCall(0).args[0].content);
        assertUndefined(mockMarkdown.getCall(1).args[0].content);
        assertEqual(1, mockTemplate.callCount);
        assertEqual('About', mockTemplate.getCall(0).args[0].title);
        assertEqual('<p>markdown content</p>\n', mockTemplate.getCall(0).args[0].content['page-block-1']);
        assertEqual('<p>markdown content</p>\n', mockTemplate.getCall(0).args[0].content['page-block-2']);
        assertEqual('<html><body><p>content</p></body></html>', result);
    });
});

describe('ViewService#getPageMarkup without template or markdown', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let result;

    before(async () => {
        const fileSystem = {
            readDirectory: sinon.stub().resolves([]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub()
                .onFirstCall().resolves(null), // No page template
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkup('/about', { title: 'About' });
    });

    after(() => {
        sinon.restore();
    });

    it('should *not* request markdown template', () => {
        assertEqual(1, mockTemplateEngine.getTemplate.callCount);
    });

    it('should request html template', () => {
        assertEqual(1, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/page.html', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
    });

    it('should return empty string "" when no template or markdown found', () => {
        assertEqual('', result);
    });
});

describe('ViewService#getPageMarkup with no html template', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockMarkdownTemplate;
    const templateContext = { title: 'About' };
    let result;

    before(async () => {

        const fileSystem = {
            readDirectory: sinon.stub().resolves([
                {
                    name: 'page-block-1.md',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'page-block-2.md',
                    isFile: sinon.stub().returns(true),
                },
            ]),
        };

        mockMarkdownTemplate = sinon.stub().returns('markdown content');

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub()
                .onFirstCall().resolves(mockMarkdownTemplate)
                .onSecondCall().resolves(mockMarkdownTemplate)
                .onThirdCall().resolves(null),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkup('/about', templateContext);
    });

    after(() => {
        sinon.restore();
    });

    it('should request markdown template', () => {
        assertEqual(3, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/page-block-1.md', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual('about/page-block-2.md', mockTemplateEngine.getTemplate.getCall(1).args[0]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page-block-1.md'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page-block-2.md'), mockTemplateEngine.getTemplate.getCall(1).args[1]);
    });

    it('should request html template', () => {
        assertEqual(3, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/page.html', mockTemplateEngine.getTemplate.getCall(2).args[0]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), mockTemplateEngine.getTemplate.getCall(2).args[1]);
    });

    it('should return rendered markdown HTML', () => {
        assertEqual(2, mockMarkdownTemplate.callCount);
        assertEqual(templateContext, mockMarkdownTemplate.getCall(0).args[0]);
        assertEqual(templateContext, mockMarkdownTemplate.getCall(1).args[0]);
        assertEqual('\n<p>markdown content</p>\n\n<p>markdown content</p>\n', result);
    });
});

describe('ViewService#getPageMarkup without markdown template', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockTemplate;
    let result;

    before(async () => {
        mockTemplate = sinon.stub().returns('<html><body><p>content</p></body></html>');

        const fileSystem = {
            readDirectory: sinon.stub().resolves([]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub()
                .onFirstCall().resolves(mockTemplate),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkup('/about', { title: 'About' });
    });

    after(() => {
        sinon.restore();
    });

    it('should not request markdown template', () => {
        assertEqual(1, mockTemplateEngine.getTemplate.callCount);
    });

    it('should request html template', () => {
        assertEqual(1, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/page.html', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
    });

    it('should return rendered html template', () => {
        assertEqual(1, mockTemplate.callCount);
        assertEqual('About', mockTemplate.getCall(0).args[0].title);
        assertEqual('<html><body><p>content</p></body></html>', result);
    });
});

describe('ViewService#getPageMarkdown with valid markdown files', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockFileSystem;
    let mockMarkdownTemplate1;
    let mockMarkdownTemplate2;
    const templateContext = { title: 'About', content: 'Welcome to our about page' };
    let result;

    before(async () => {
        mockMarkdownTemplate1 = sinon.stub().returns('# About Us\n\nWelcome to our about page');
        mockMarkdownTemplate2 = sinon.stub().returns('## Team\n\nOur amazing team members');

        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                {
                    name: 'intro.md',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'team.md',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'not-markdown.txt',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'subdir',
                    isFile: sinon.stub().returns(false),
                },
            ]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub()
                .onFirstCall().resolves(mockMarkdownTemplate1)
                .onSecondCall().resolves(mockMarkdownTemplate2),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem: mockFileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkdown('/about', templateContext);
    });

    after(() => {
        sinon.restore();
    });

    it('should read directory contents', () => {
        assertEqual(1, mockFileSystem.readDirectory.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about'), mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should request markdown templates with correct template IDs', () => {
        assertEqual(2, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/intro.md', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual('about/team.md', mockTemplateEngine.getTemplate.getCall(1).args[0]);
    });

    it('should request markdown templates with correct filepaths', () => {
        assertEqual(2, mockTemplateEngine.getTemplate.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'intro.md'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'team.md'), mockTemplateEngine.getTemplate.getCall(1).args[1]);
    });

    it('should call markdown templates with page data', () => {
        assertEqual(1, mockMarkdownTemplate1.callCount);
        assertEqual(1, mockMarkdownTemplate2.callCount);
        assertEqual(templateContext, mockMarkdownTemplate1.getCall(0).args[0]);
        assertEqual(templateContext, mockMarkdownTemplate2.getCall(0).args[0]);
    });

    it('should return object with parsed markdown HTML', () => {
        assertEqual('<h1>About Us</h1>\n<p>Welcome to our about page</p>\n', result['intro']);
        assertEqual('<h2>Team</h2>\n<p>Our amazing team members</p>\n', result['team']);
    });
});

describe('ViewService#getPageMarkdown with trailing slash in pathname', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockFileSystem;
    let mockMarkdownTemplate;
    let result;

    before(async () => {
        mockMarkdownTemplate = sinon.stub().returns('# About Us\n\nContent');

        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                {
                    name: 'content.md',
                    isFile: sinon.stub().returns(true),
                },
            ]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(mockMarkdownTemplate),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem: mockFileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkdown('/about/', { title: 'About' });
    });

    after(() => {
        sinon.restore();
    });

    it('should normalize pathname and read correct directory', () => {
        assertEqual(1, mockFileSystem.readDirectory.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about'), mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should use correct template ID for normalized path', () => {
        assertEqual(1, mockTemplateEngine.getTemplate.callCount);
        assertEqual('about/content.md', mockTemplateEngine.getTemplate.getCall(0).args[0]);
    });

    it('should return object with parsed markdown HTML', () => {
        assertEqual('<h1>About Us</h1>\n<p>Content</p>\n', result['content']);
    });
});

describe('ViewService#getPageMarkdown with nested pathname', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockFileSystem;
    let mockMarkdownTemplate;
    let result;

    before(async () => {
        mockMarkdownTemplate = sinon.stub().returns('# Blog Post\n\nContent');

        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                {
                    name: 'post.md',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'comments.md',
                    isFile: sinon.stub().returns(true),
                },
            ]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub()
                .onFirstCall().resolves(mockMarkdownTemplate)
                .onSecondCall().resolves(mockMarkdownTemplate),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem: mockFileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkdown('/blog/2023/my-post', { title: 'Blog Post' });
    });

    after(() => {
        sinon.restore();
    });

    it('should read correct nested directory', () => {
        assertEqual(1, mockFileSystem.readDirectory.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'blog', '2023', 'my-post'), mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should use correct template IDs for nested path', () => {
        assertEqual(2, mockTemplateEngine.getTemplate.callCount);
        assertEqual('blog/2023/my-post/post.md', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual('blog/2023/my-post/comments.md', mockTemplateEngine.getTemplate.getCall(1).args[0]);
    });

    it('should use correct filepaths for nested path', () => {
        assertEqual(2, mockTemplateEngine.getTemplate.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'blog', '2023', 'my-post', 'post.md'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
        assertEqual(path.join(MOCK_DIR, 'pages', 'blog', '2023', 'my-post', 'comments.md'), mockTemplateEngine.getTemplate.getCall(1).args[1]);
    });

    it('should return object with parsed markdown HTML', () => {
        assertEqual('<h1>Blog Post</h1>\n<p>Content</p>\n', result['post']);
        assertEqual('<h1>Blog Post</h1>\n<p>Content</p>\n', result['comments']);
    });
});

describe('ViewService#getPageMarkdown with no markdown files', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockFileSystem;
    let result;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                {
                    name: 'not-markdown.txt',
                    isFile: sinon.stub().returns(true),
                },
                {
                    name: 'subdir',
                    isFile: sinon.stub().returns(false),
                },
            ]),
        };

        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
            fileSystem: mockFileSystem,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getPageMarkdown('/about', { title: 'About' });
    });

    after(() => {
        sinon.restore();
    });

    it('should read directory contents', () => {
        assertEqual(1, mockFileSystem.readDirectory.callCount);
        assertEqual(path.join(MOCK_DIR, 'pages', 'about'), mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should not request any markdown templates', () => {
        assertEqual(0, mockTemplateEngine.getTemplate.callCount);
    });

    it('should return empty object when no markdown files found', () => {
        assertEqual(0, Object.keys(result).length);
    });
});

describe('ViewService#getBaseTemplate', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockTemplate;
    let result;

    before(async () => {
        mockTemplate = sinon.stub().returns('<html><body><p>content</p></body></html>');
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(mockTemplate),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getBaseTemplate('custom.html');
    });

    after(() => {
        sinon.restore();
    });

    it('should request template with correct path', () => {
        assertEqual(1, mockTemplateEngine.getTemplate.callCount);
        assertEqual('custom.html', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual(path.join(MOCK_DIR, 'templates', 'custom.html'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
    });

    it('should return template function', () => {
        assertEqual(mockTemplate, result);
    });
});

describe('ViewService#getBaseTemplate with default template', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockTemplate;
    let result;

    before(async () => {
        mockTemplate = sinon.stub().returns('<html><body><p>content</p></body></html>');
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(mockTemplate),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.getBaseTemplate(undefined);
    });

    after(() => {
        sinon.restore();
    });

    it('should use default template ID', () => {
        assertEqual('base.html', mockTemplateEngine.getTemplate.getCall(0).args[0]);
        assertEqual(path.join(MOCK_DIR, 'templates', 'base.html'), mockTemplateEngine.getTemplate.getCall(0).args[1]);
    });

    it('should return template function', () => {
        assertEqual(mockTemplate, result);
    });
});

describe('ViewService#hydrateMetadataTemplate with valid template', ({ before, after, it }) => {
    let subject;
    let mockTemplateEngine;
    let mockRenderFunction;
    const templateContext = { title: 'My Title', description: 'My Description' };
    let result;

    before(async () => {
        mockRenderFunction = sinon.stub().returns('My Title - My Description');
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            createMetadataTemplate: sinon.stub().resolves(mockRenderFunction),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.hydrateMetadataTemplate('title', '{{title}} - {{description}}', templateContext);
    });

    after(() => {
        sinon.restore();
    });

    it('should create metadata template', () => {
        assertEqual(1, mockTemplateEngine.createMetadataTemplate.callCount);
        assertEqual('title', mockTemplateEngine.createMetadataTemplate.getCall(0).args[0]);
        assertEqual('{{title}} - {{description}}', mockTemplateEngine.createMetadataTemplate.getCall(0).args[1]);
    });

    it('should return hydrated template', () => {
        assertEqual(1, mockRenderFunction.callCount);
        assertEqual(templateContext, mockRenderFunction.getCall(0).args[0]);
        assertEqual('My Title - My Description', result);
    });
});

describe('ViewService#readPageDataJSONFile with valid JSON', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let result;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(null),
        };

        mockFileSystem = {
            readUtf8File: sinon.stub().resolves('{"title": "Test", "content": "Hello"}'),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.readPageDataJSONFile('/test/data.json');
    });

    after(() => {
        sinon.restore();
    });

    it('should parse valid JSON', () => {
        assertEqual('Test', result.title);
        assertEqual('Hello', result.content);
    });
});

describe('ViewService#readPageDataJSONFile with JSONC fallback', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let result;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(null),
        };

        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // .json file not found
                .onSecondCall().resolves('{"title": "Test", "content": "Hello"}'), // .jsonc file found
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: '/test/pages',
            templatesDirectory: '/test/templates',
            partialsDirectory: '/test/partials',
            helpersDirectory: '/test/helpers',
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.readPageDataJSONFile('/test/data.json');
    });

    after(() => {
        sinon.restore();
    });

    it('should try .jsonc extension when .json not found', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/data.json', mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual('/test/data.jsonc', mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should parse JSONC content', () => {
        assertEqual('Test', result.title);
        assertEqual('Hello', result.content);
    });
});

describe('ViewService#readPageDataJSONFile with JSON fallback', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let result;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(null),
        };

        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // .json file not found
                .onSecondCall().resolves('{"title": "Test", "content": "Hello"}'), // .jsonc file found
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: '/test/pages',
            templatesDirectory: '/test/templates',
            partialsDirectory: '/test/partials',
            helpersDirectory: '/test/helpers',
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
        result = await subject.readPageDataJSONFile('/test/data.jsonc');
    });

    after(() => {
        sinon.restore();
    });

    it('should try .json extension when .jsonc not found', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/data.jsonc', mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual('/test/data.json', mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should parse JSON content', () => {
        assertEqual('Test', result.title);
        assertEqual('Hello', result.content);
    });
});

describe('ViewService#readPageDataJSONFile with invalid JSON', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let mockTemplateEngine;
    let error;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(null),
        };

        mockFileSystem = {
            readUtf8File: sinon.stub().resolves('{"title": "Test", content: "Hello"}'), // Invalid JSON
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            fileSystem: mockFileSystem,
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();

        try {
            await subject.readPageDataJSONFile('/test/data.json');
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('should throw ValidationError for invalid JSON', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('VALIDATION_ERROR', error.code);
    });
});

describe('ViewService#filepathForPagePath with normal path', ({ before, it }) => {
    let subject;
    let mockTemplateEngine;

    before(() => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(null),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
    });

    it('should resolve normal path correctly', () => {
        const result = subject.filepathForPagePath('/about', 'page.html');
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), result);
    });

    it('should handle trailing slash', () => {
        const result = subject.filepathForPagePath('/about/', 'page.html');
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.html'), result);
    });

    it('should handle index page', () => {
        const result = subject.filepathForPagePath('/about/index', 'page.md');
        assertEqual(path.join(MOCK_DIR, 'pages', 'about', 'page.md'), result);
    });

    it('should handle nested paths', () => {
        const result = subject.filepathForPagePath('/blog/2023/post', 'page.md');
        assertEqual(path.join(MOCK_DIR, 'pages', 'blog', '2023', 'post', 'page.md'), result);
    });
});

describe('ViewService#filepathForTemplate with normal path', ({ before, it }) => {
    let subject;
    let mockTemplateEngine;

    before(() => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub().resolves(null),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        subject = new ViewService(options);
        subject.initialize();
    });

    it('should resolve template path correctly', () => {
        const result = subject.filepathForTemplate('base.html');
        assertEqual(path.join(MOCK_DIR, 'templates', 'base.html'), result);
    });

    it('should handle nested template paths', () => {
        const result = subject.filepathForTemplate('layouts/main.html');
        assertEqual(path.join(MOCK_DIR, 'templates', 'layouts', 'main.html'), result);
    });

    it('should handle leading and trailing slashes', () => {
        const result = subject.filepathForTemplate('/base.html/');
        assertEqual(path.join(MOCK_DIR, 'templates', 'base.html'), result);
    });
});

describe('ViewService#createAndInitialize static method', ({ before, after, it }) => {
    let mockTemplateEngine;
    let result;

    before(async () => {
        mockTemplateEngine = {
            initialize: sinon.stub().resolves(),
            getTemplate: sinon.stub(),
            createMetadataTemplate: sinon.stub(),
        };

        const options = {
            logger: { warn: sinon.stub() },
            pageDirectory: path.join(MOCK_DIR, 'pages'),
            templatesDirectory: path.join(MOCK_DIR, 'templates'),
            partialsDirectory: path.join(MOCK_DIR, 'partials'),
            helpersDirectory: path.join(MOCK_DIR, 'helpers'),
            pageTemplateEngine: mockTemplateEngine,
        };

        result = await ViewService.createAndInitialize(options);
    });

    after(() => {
        sinon.restore();
    });

    it('should create ViewService instance', () => {
        assert(result instanceof ViewService);
    });

    it('should initialize the instance', () => {
        assertEqual(1, mockTemplateEngine.initialize.callCount);
    });
});
