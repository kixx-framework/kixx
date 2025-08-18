import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual,
    assertFunction,
    assertMatches
} from 'kixx-assert';
import PageTemplateEngine from '../../lib/view-service/page-template-engine.js';

describe('PageTemplateEngine#constructor with valid options', ({ before, it }) => {
    let subject;
    const options = {
        helpersDirectory: '/test/helpers',
        partialsDirectory: '/test/partials',
    };

    before(() => {
        subject = new PageTemplateEngine(options);
    });

    it('should initialize helpers Map with built-in helpers', () => {
        assert(subject.helpers instanceof Map);
        assert(subject.helpers.has('format_date'));
        assert(subject.helpers.has('plus_one'));
    });

    it('should initialize partials Map', () => {
        assert(subject.partials instanceof Map);
        assertEqual(0, subject.partials.size);
    });
});

describe('PageTemplateEngine#initialize with valid helpers directory', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const mockHelper = {
        name: 'test_helper',
        helper: sinon.stub(),
    };

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                { name: 'test_helper.js', isFile: () => true, isDirectory: () => false },
            ]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub().resolves(mockHelper),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('should load custom helpers from directory', () => {
        assertEqual(1, mockFileSystem.readDirectory.callCount);
        assertEqual('/test/helpers', mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should import helper modules', () => {
        assertEqual(1, mockFileSystem.importAbsoluteFilepath.callCount);
        assertEqual('/test/helpers/test_helper.js', mockFileSystem.importAbsoluteFilepath.getCall(0).args[0]);
    });

    it('should register custom helper', () => {
        assert(subject.helpers.has('test_helper'));
        assertFunction(subject.helpers.get('test_helper'));
    });
});

describe('PageTemplateEngine#initialize with empty helpers directory', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('should not import any helpers', () => {
        assertEqual(0, mockFileSystem.importAbsoluteFilepath.callCount);
    });

    it('should keep only built-in helpers', () => {
        assert(subject.helpers.has('format_date'));
        assert(subject.helpers.has('plus_one'));
        // There are 5 built-in helpers from kixx-templating library. Then we add additional built-in
        // helpers from the Kixx framework ViewService.
        assertEqual(7, subject.helpers.size);
    });
});

describe('PageTemplateEngine#initialize with helpers directory read error', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let error;

    before(async () => {
        const readError = new Error('Permission denied');
        readError.code = 'EACCES';

        mockFileSystem = {
            readDirectory: sinon.stub().rejects(readError),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        try {
            await subject.initialize();
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
        assertEqual('Unable to read helpers directory /test/helpers', error.message);
        assertEqual('EACCES', error.cause.code);
    });
});

describe('PageTemplateEngine#initialize with helper import error', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let error;

    before(async () => {
        const importError = new Error('Module not found');
        importError.code = 'ERR_MODULE_NOT_FOUND';

        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                { name: 'broken_helper.js', isFile: () => true, isDirectory: () => false },
            ]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub().rejects(importError),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        try {
            await subject.initialize();
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
        assertEqual('Unable to load template helper from /test/helpers/broken_helper.js', error.message);
        assertEqual('ERR_MODULE_NOT_FOUND', error.cause.code);
    });
});

describe('PageTemplateEngine#initialize with invalid helper module', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let error;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                { name: 'invalid_helper.js', isFile: () => true, isDirectory: () => false },
            ]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub().resolves({
                // Missing name and helper properties
            }),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        try {
            await subject.initialize();
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('should throw AssertionError for missing name', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches(/^A template helper file must export a `name`/, error.message);
    });
});

describe('PageTemplateEngine#loadPartials with valid partials directory', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub()
                .onFirstCall().resolves([
                    { name: 'header.html', isFile: () => true, isDirectory: () => false },
                    { name: 'footer.html', isFile: () => true, isDirectory: () => false },
                ]),
            readUtf8File: sinon.stub()
                .onFirstCall().resolves('<header>{{title}}</header>')
                .onSecondCall().resolves('<footer>{{year}}</footer>'),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.loadPartials();
    });

    after(() => {
        sinon.restore();
    });

    it('should read partials directory', () => {
        assertEqual(1, mockFileSystem.readDirectory.callCount);
        assertEqual('/test/partials', mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should read partial files', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
    });

    it('should compile and register partials', () => {
        assertEqual(2, subject.partials.size);
        assert(subject.partials.has('header.html'));
        assert(subject.partials.has('footer.html'));
        assertFunction(subject.partials.get('header.html'));
        assertFunction(subject.partials.get('footer.html'));
    });
});

describe('PageTemplateEngine#loadPartials with nested directory structure', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub()
                .onFirstCall().resolves([
                    { name: 'components', isDirectory: () => true, isFile: () => false },
                ])
                .onSecondCall().resolves([
                    { name: 'button.html', isFile: () => true, isDirectory: () => false },
                ]),
            readUtf8File: sinon.stub()
                .onFirstCall().resolves('<button>{{text}}</button>'),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.loadPartials();
    });

    after(() => {
        sinon.restore();
    });

    it('should traverse nested directories', () => {
        assertEqual(2, mockFileSystem.readDirectory.callCount);
    });

    it('should register partial with nested path', () => {
        assert(subject.partials.has('components/button.html'));
        assertFunction(subject.partials.get('components/button.html'));
    });
});

describe('PageTemplateEngine#loadPartials with empty directory', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.loadPartials();
    });

    after(() => {
        sinon.restore();
    });

    it('should clear existing partials', () => {
        assertEqual(0, subject.partials.size);
    });
});

describe('PageTemplateEngine#loadPartials with directory read error', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let error;

    before(async () => {
        const readError = new Error('Directory not found');
        readError.code = 'ENOACCESS';

        mockFileSystem = {
            readDirectory: sinon.stub().rejects(readError),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        try {
            await subject.loadPartials();
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
        assertEqual('ENOACCESS', error.code);
        assertEqual('ENOACCESS', error.cause.code);
    });
});

describe('PageTemplateEngine#compileTemplate with valid template', ({ before, it }) => {
    let subject;
    let result;

    before(() => {
        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
        });

        result = subject.compileTemplate('test', 'Hello {{name}}!');
    });

    it('should return a function', () => {
        assertFunction(result);
    });

    it('should compile template correctly', () => {
        const rendered = result({ name: 'World' });
        assertEqual('Hello World!', rendered);
    });
});

describe('PageTemplateEngine#compileTemplate without partials', ({ before, it }) => {
    let subject;
    let result;

    before(() => {
        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
        });

        // Add a partial to test exclusion
        subject.partials.set('test.html', () => 'partial content');

        const templateString = 'Hello {{name}}! ({{> test.html}})';
        result = subject.compileTemplate('test', templateString, false);
    });

    it('should return a function', () => {
        assertFunction(result);
    });

    it('should not include partials in compilation', () => {
        let error;
        try {
            result({ name: 'World' });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('LineSyntaxError', error.name);
        assertEqual('No partial named "test.html" in "test" on line 1', error.message);
    });
});

describe('PageTemplateEngine#getTemplate with existing file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([]),
            readUtf8File: sinon.stub().resolves('Hello {{name}}!'),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.initialize();

        result = await subject.getTemplate('test', '/test/template.html');
    });

    after(() => {
        sinon.restore();
    });

    it('should load helpers first', () => {
        assertEqual('/test/helpers', mockFileSystem.readDirectory.getCall(0).args[0]);
    });

    it('should load partials second', () => {
        assertEqual('/test/partials', mockFileSystem.readDirectory.getCall(1).args[0]);
    });

    it('should read template file', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/template.html', mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should return compiled template function', () => {
        assertFunction(result);
        const rendered = result({ name: 'World' });
        assertEqual('Hello World!', rendered);
    });
});

describe('PageTemplateEngine#getTemplate with non-existent file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([]),
            readUtf8File: sinon.stub().resolves(null),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        result = await subject.getTemplate('test', '/test/nonexistent.html');
    });

    after(() => {
        sinon.restore();
    });

    it('should return null for non-existent file', () => {
        assertEqual(null, result);
    });
});

describe('PageTemplateEngine#getTemplate with file read error', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let error;

    before(async () => {
        const readError = new Error('Permission denied');
        readError.code = 'EACCES';

        mockFileSystem = {
            readDirectory: sinon.stub().resolves([]),
            readUtf8File: sinon.stub().rejects(readError),
            importAbsoluteFilepath: sinon.stub(),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        try {
            await subject.getTemplate('test', '/test/forbidden.html');
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

describe('PageTemplateEngine#createMetadataTemplate', ({ before, it }) => {
    let subject;
    let result;

    before(async () => {
        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
        });

        result = await subject.createMetadataTemplate('metadata', '{{title}} - {{description}}');
    });

    it('should return compiled template function without partials', () => {
        assertFunction(result);
        const rendered = result({ title: 'My Title', description: 'My Description' });
        assertEqual('My Title - My Description', rendered);
    });
});

describe('PageTemplateEngine#createMetadataTemplate with invalid partial reference', ({ before, it }) => {
    let subject;
    let result;

    before(async () => {
        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
        });

        // Add a partial to test exclusion
        subject.partials.set('test.html', () => 'partial content');

        result = await subject.createMetadataTemplate('metadata', '{{title}} - {{description}} ({{> test.html}})');
    });

    it('should return compiled template function', () => {
        let error;
        try {
            result({ title: 'My Title', description: 'My Description' });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('LineSyntaxError', error.name);
        assertEqual('No partial named "test.html" in "metadata" on line 1', error.message);
    });
});

describe('PageTemplateEngine#loadHelpers with valid helper modules', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const mockHelper1 = {
        name: 'helper1',
        helper: sinon.stub().returns('result1'),
    };
    const mockHelper2 = {
        name: 'helper2',
        helper: sinon.stub().returns('result2'),
    };

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                { name: 'helper1.js', isFile: () => true, isDirectory: () => false },
                { name: 'helper2.js', isFile: () => true, isDirectory: () => false },
            ]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub()
                .onFirstCall().resolves(mockHelper1)
                .onSecondCall().resolves(mockHelper2),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.loadHelpers('/test/helpers');
    });

    after(() => {
        sinon.restore();
    });

    it('should load multiple helpers', () => {
        assertEqual(2, mockFileSystem.importAbsoluteFilepath.callCount);
    });

    it('should register all helpers', () => {
        assert(subject.helpers.has('helper1'));
        assert(subject.helpers.has('helper2'));
        assertFunction(subject.helpers.get('helper1'));
        assertFunction(subject.helpers.get('helper2'));
    });

    it('should preserve built-in helpers', () => {
        assert(subject.helpers.has('format_date'));
        assert(subject.helpers.has('plus_one'));
    });
});

describe('PageTemplateEngine#loadHelpers with directory containing non-files', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readDirectory: sinon.stub().resolves([
                { name: 'helper.js', isFile: () => true, isDirectory: () => false },
                { name: 'subdirectory', isDirectory: () => true, isFile: () => false },
            ]),
            readUtf8File: sinon.stub(),
            importAbsoluteFilepath: sinon.stub().resolves({
                name: 'helper',
                helper: sinon.stub(),
            }),
        };

        subject = new PageTemplateEngine({
            helpersDirectory: '/test/helpers',
            partialsDirectory: '/test/partials',
            fileSystem: mockFileSystem,
        });

        await subject.loadHelpers('/test/helpers');
    });

    after(() => {
        sinon.restore();
    });

    it('should only process files, not directories', () => {
        assertEqual(1, mockFileSystem.importAbsoluteFilepath.callCount);
        assertEqual('/test/helpers/helper.js', mockFileSystem.importAbsoluteFilepath.getCall(0).args[0]);
    });
});
