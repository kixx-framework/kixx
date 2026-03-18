import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertArray, assertFunction } from 'kixx-assert';
import sinon from 'sinon';
import TemplateStore from '../../../../lib/hyperview/node-local-store/template-store.js';
import { testHyperviewTemplateStoreConformance } from '../../../conformance/hyperview-template-store.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

testHyperviewTemplateStoreConformance(() => {
    const fileSystem = {
        readUtf8File: sinon.stub().resolves(null),
        readDirectory: sinon.stub().resolves([]),
        importAbsoluteFilepath: sinon.stub().resolves({}),
    };
    return new TemplateStore({
        helpersDirectory: '/helpers',
        partialsDirectory: '/partials',
        templatesDirectory: '/templates',
        fileSystem,
    });
});

function createMockFileSystem(overrides = {}) {
    return {
        readUtf8File: sinon.stub(),
        readDirectory: sinon.stub(),
        importAbsoluteFilepath: sinon.stub(),
        ...overrides,
    };
}

describe('TemplateStore constructor when options.helpersDirectory is empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new TemplateStore({
                helpersDirectory: '',
                partialsDirectory: '/partials',
                templatesDirectory: '/templates',
                fileSystem: createMockFileSystem(),
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('TemplateStore constructor when options.partialsDirectory is empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new TemplateStore({
                helpersDirectory: '/helpers',
                partialsDirectory: '',
                templatesDirectory: '/templates',
                fileSystem: createMockFileSystem(),
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('TemplateStore constructor when options.templatesDirectory is empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new TemplateStore({
                helpersDirectory: '/helpers',
                partialsDirectory: '/partials',
                templatesDirectory: '',
                fileSystem: createMockFileSystem(),
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('TemplateStore constructor when options.fileSystem is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new TemplateStore({
                helpersDirectory: '/helpers',
                partialsDirectory: '/partials',
                templatesDirectory: '/templates',
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('TemplateStore#getBaseTemplate() when templateId resolves outside templates directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: THIS_DIR,
            fileSystem,
        });
        result = await store.getBaseTemplate('../../../etc/passwd');
    });

    it('returns null', () => assertEqual(null, result));
    it('does not call readUtf8File', () => assertEqual(0, fileSystem.readUtf8File.callCount));
});

describe('TemplateStore#getBaseTemplate() when file does not exist', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readUtf8File.resolves(null);
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: THIS_DIR,
            fileSystem,
        });
        result = await store.getBaseTemplate('layouts/base.html');
    });

    it('returns null', () => assertEqual(null, result));
});

describe('TemplateStore#getBaseTemplate() when template exists', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readUtf8File.resolves('<html><body>{{content}}</body></html>');
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: THIS_DIR,
            fileSystem,
        });
        result = await store.getBaseTemplate('layouts/base.html');
    });

    it('returns SourceFile with templateId as filename', () => assertEqual('layouts/base.html', result.filename));
    it('returns source content', () => assertEqual('<html><body>{{content}}</body></html>', result.source));
    it('calls readUtf8File with resolved filepath', () => {
        const expected = path.join(THIS_DIR, 'layouts', 'base.html');
        assertEqual(expected, fileSystem.readUtf8File.getCall(0).firstArg);
    });
});

describe('TemplateStore#getPartialFile() when partialId resolves outside partials directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: THIS_DIR,
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.getPartialFile('../../../etc/passwd');
    });

    it('returns null', () => assertEqual(null, result));
});

describe('TemplateStore#getPartialFile() when partial exists', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readUtf8File.resolves('<div class="card">{{name}}</div>');
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: THIS_DIR,
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.getPartialFile('cards/user.html');
    });

    it('returns SourceFile with partialId as filename', () => assertEqual('cards/user.html', result.filename));
    it('returns source content', () => assertEqual('<div class="card">{{name}}</div>', result.source));
});

describe('TemplateStore#getHelperFile() when helperId contains slash (nested path)', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.getHelperFile('sub/format-date.js');
    });

    it('returns null', () => assertEqual(null, result));
    it('does not call readUtf8File', () => assertEqual(0, fileSystem.readUtf8File.callCount));
});

describe('TemplateStore#getHelperFile() when helper exists', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readUtf8File.resolves('export const name = "formatDate"; export function helper() {}');
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: THIS_DIR,
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.getHelperFile('format-date.js');
    });

    it('returns SourceFile with helperId as filename', () => assertEqual('format-date.js', result.filename));
    it('returns source content', () => assertEqual('export const name = "formatDate"; export function helper() {}', result.source));
});

describe('TemplateStore#loadPartialFiles() when readDirectory succeeds with flat files', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([
        { name: 'header.html', isFile: true, isDirectory: false },
        { name: 'footer.html', isFile: true, isDirectory: false },
    ]);
    fileSystem.readUtf8File.onFirstCall().resolves('<header>');
    fileSystem.readUtf8File.onSecondCall().resolves('</footer>');
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: THIS_DIR,
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.loadPartialFiles();
    });

    it('returns array of SourceFile objects', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual('header.html', result[0].filename);
        assertEqual('<header>', result[0].source);
        assertEqual('footer.html', result[1].filename);
        assertEqual('</footer>', result[1].source);
    });
});

describe('TemplateStore#loadPartialFiles() when directory has subdirectories', ({ before, it }) => {
    const partialsDir = THIS_DIR;
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory
        .onFirstCall()
        .resolves([{ name: 'cards', isFile: false, isDirectory: true }])
        .onSecondCall()
        .resolves([{ name: 'user.html', isFile: true, isDirectory: false }]);
    fileSystem.readUtf8File.resolves('<div>user</div>');
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: path.join(THIS_DIR, 'helpers'),
            partialsDirectory: partialsDir,
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.loadPartialFiles();
    });

    it('preserves directory structure in filename', () => {
        assertArray(result);
        assertEqual(1, result.length);
        assertEqual('cards/user.html', result[0].filename);
        assertEqual('<div>user</div>', result[0].source);
    });
});

describe('TemplateStore#loadPartialFiles() when readDirectory throws', ({ it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.rejects(new Error('Permission denied'));

    it('throws WrappedError', async () => {
        let error;
        try {
            const store = new TemplateStore({
                helpersDirectory: path.join(THIS_DIR, 'helpers'),
                partialsDirectory: THIS_DIR,
                templatesDirectory: path.join(THIS_DIR, 'templates'),
                fileSystem,
            });
            await store.loadPartialFiles();
        } catch (err) {
            error = err;
        }
        assertEqual('WrappedError', error.name);
        assertEqual(true, error.message.includes('Unable to read partials directory'));
    });
});

describe('TemplateStore#loadHelperFiles() when readDirectory succeeds', ({ before, it }) => {
    const helpersDir = THIS_DIR;
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([
        { name: 'format-date.js', isFile: true },
        { name: 'truncate.js', isFile: true },
    ]);
    fileSystem.importAbsoluteFilepath
        .onFirstCall()
        .resolves({ name: 'formatDate', helper: function formatDate() {} })
        .onSecondCall()
        .resolves({ name: 'truncate', helper: function truncate() {} });
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: helpersDir,
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.loadHelperFiles();
    });

    it('returns array of helper objects with name and helper', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual('formatDate', result[0].name);
        assertFunction(result[0].helper);
        assertEqual('truncate', result[1].name);
        assertFunction(result[1].helper);
    });
});

describe('TemplateStore#loadHelperFiles() when helper module does not export name string', ({ it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'bad-helper.js', isFile: true }]);
    fileSystem.importAbsoluteFilepath.resolves({ name: 123, helper: function h() {} });

    it('throws AssertionError', async () => {
        let error;
        try {
            const store = new TemplateStore({
                helpersDirectory: THIS_DIR,
                partialsDirectory: path.join(THIS_DIR, 'partials'),
                templatesDirectory: path.join(THIS_DIR, 'templates'),
                fileSystem,
            });
            await store.loadHelperFiles();
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual(true, error.message.includes('must export a name string'));
    });
});

describe('TemplateStore#loadHelperFiles() when helper module does not export helper function', ({ it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'bad-helper.js', isFile: true }]);
    fileSystem.importAbsoluteFilepath.resolves({ name: 'badHelper', helper: 'not a function' });

    it('throws AssertionError', async () => {
        let error;
        try {
            const store = new TemplateStore({
                helpersDirectory: THIS_DIR,
                partialsDirectory: path.join(THIS_DIR, 'partials'),
                templatesDirectory: path.join(THIS_DIR, 'templates'),
                fileSystem,
            });
            await store.loadHelperFiles();
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual(true, error.message.includes('must export a helper function'));
    });
});

describe('TemplateStore#loadHelperFiles() when readDirectory throws', ({ it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.rejects(new Error('ENOENT'));

    it('throws WrappedError', async () => {
        let error;
        try {
            const store = new TemplateStore({
                helpersDirectory: THIS_DIR,
                partialsDirectory: path.join(THIS_DIR, 'partials'),
                templatesDirectory: path.join(THIS_DIR, 'templates'),
                fileSystem,
            });
            await store.loadHelperFiles();
        } catch (err) {
            error = err;
        }
        assertEqual('WrappedError', error.name);
        assertEqual(true, error.message.includes('Unable to read helpers directory'));
    });
});

describe('TemplateStore#loadHelperFiles() when importAbsoluteFilepath throws', ({ it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'broken.js', isFile: true }]);
    fileSystem.importAbsoluteFilepath.rejects(new Error('SyntaxError'));

    it('throws WrappedError', async () => {
        let error;
        try {
            const store = new TemplateStore({
                helpersDirectory: THIS_DIR,
                partialsDirectory: path.join(THIS_DIR, 'partials'),
                templatesDirectory: path.join(THIS_DIR, 'templates'),
                fileSystem,
            });
            await store.loadHelperFiles();
        } catch (err) {
            error = err;
        }
        assertEqual('WrappedError', error.name);
        assertEqual(true, error.message.includes('Unable to load template helper'));
    });
});

describe('TemplateStore#loadHelperFiles() filters out directories', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([
        { name: 'format-date.js', isFile: true },
        { name: 'utils', isFile: false },
    ]);
    fileSystem.importAbsoluteFilepath.resolves({ name: 'formatDate', helper: function h() {} });
    let result;

    before(async () => {
        const store = new TemplateStore({
            helpersDirectory: THIS_DIR,
            partialsDirectory: path.join(THIS_DIR, 'partials'),
            templatesDirectory: path.join(THIS_DIR, 'templates'),
            fileSystem,
        });
        result = await store.loadHelperFiles();
    });

    it('loads only file entries', () => {
        assertEqual(1, result.length);
        assertEqual(1, fileSystem.importAbsoluteFilepath.callCount);
    });
});
