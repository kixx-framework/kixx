import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertArray } from 'kixx-assert';
import sinon from 'sinon';
import PageStore from '../../../../lib/node/hyperview-local-store/page-store.js';
import { testHyperviewPageStoreConformance } from '../../../conformance/hyperview-page-store.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

testHyperviewPageStoreConformance(() => {
    const fileSystem = {
        getFileStats: sinon.stub().resolves(null),
        readDirectory: sinon.stub().resolves([]),
        readJSONFile: sinon.stub().resolves(null),
        readUtf8File: sinon.stub().resolves(null),
    };
    return new PageStore({ directory: '/pages', fileSystem });
});

function createMockFileSystem(overrides = {}) {
    return {
        getFileStats: sinon.stub(),
        readDirectory: sinon.stub(),
        readJSONFile: sinon.stub(),
        readUtf8File: sinon.stub(),
        ...overrides,
    };
}

describe('PageStore constructor when options.directory is empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new PageStore({ directory: '', fileSystem: createMockFileSystem() });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('PageStore constructor when options.fileSystem is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new PageStore({ directory: '/pages' });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('PageStore#doesPageExist() when pathname resolves outside base directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.doesPageExist('../../../etc');
    });

    it('returns false', () => assertEqual(false, result));
    it('does not call getFileStats', () => assertEqual(0, fileSystem.getFileStats.callCount));
});

describe('PageStore#doesPageExist() when getFileStats returns directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves({ isDirectory: true });
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.doesPageExist('/blog/post');
    });

    it('passes resolved path to getFileStats', () => {
        const expected = path.resolve(THIS_DIR, 'blog', 'post');
        assertEqual(expected, fileSystem.getFileStats.getCall(0).firstArg);
    });
    it('returns true', () => assertEqual(true, result));
});

describe('PageStore#doesPageExist() when getFileStats returns non-directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves({ isDirectory: false });
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.doesPageExist('/blog/post');
    });

    it('returns false', () => assertEqual(false, result));
});

describe('PageStore#doesPageExist() when getFileStats returns null', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves(null);
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.doesPageExist('/missing');
    });

    it('returns false', () => assertEqual(false, result));
});

describe('PageStore#getPageData() when pathname resolves outside base directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageData('../../../etc');
    });

    it('returns empty object', () => assertEqual(0, Object.keys(result).length));
    it('does not call readDirectory', () => assertEqual(0, fileSystem.readDirectory.callCount));
});

describe('PageStore#getPageData() when directory has no JSON file', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'page.html', isFile: true }]);
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageData('/blog/post');
    });

    it('returns empty object', () => assertEqual(0, Object.keys(result).length));
});

describe('PageStore#getPageData() when directory has page.json', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([
        { name: 'page.html', isFile: true },
        { name: 'page.json', isFile: true },
    ]);
    fileSystem.readJSONFile.resolves({ title: 'My Post', layout: 'default' });
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageData('/blog/post');
    });

    it('returns parsed page data', () => {
        assertEqual('My Post', result.title);
        assertEqual('default', result.layout);
    });
    it('calls readJSONFile with path to page.json', () => {
        const expected = path.join(path.resolve(THIS_DIR, 'blog', 'post'), 'page.json');
        assertEqual(expected, fileSystem.readJSONFile.getCall(0).firstArg);
    });
});

describe('PageStore#getPageData() when readJSONFile returns null', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'page.json', isFile: true }]);
    fileSystem.readJSONFile.resolves(null);
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageData('/blog/post');
    });

    it('returns empty object', () => assertEqual(0, Object.keys(result).length));
});

describe('PageStore#getPageTemplate() when pathname resolves outside base directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageTemplate('../../../etc');
    });

    it('returns null', () => assertEqual(null, result));
});

describe('PageStore#getPageTemplate() when directory has page.html', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'page.html', isFile: true }]);
    fileSystem.readUtf8File.resolves('<html><body>Hello</body></html>');
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageTemplate('/blog/post');
    });

    it('returns SourceFile with filename and source', () => {
        assertEqual('page.html', result.filename);
        assertEqual('<html><body>Hello</body></html>', result.source);
    });
});

describe('PageStore#getPageTemplate() when directory has page.xml', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'page.xml', isFile: true }]);
    fileSystem.readUtf8File.resolves('<doc><title>Feed</title></doc>');
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageTemplate('/feed');
    });

    it('returns SourceFile with page.xml', () => {
        assertEqual('page.xml', result.filename);
        assertEqual('<doc><title>Feed</title></doc>', result.source);
    });
});

describe('PageStore#getPageTemplate() with options.templateFilename', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readUtf8File.resolves('<div>Custom</div>');
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageTemplate('/blog/post', { templateFilename: 'custom.html' });
    });

    it('reads the specified file', () => {
        const expected = path.join(path.resolve(THIS_DIR, 'blog', 'post'), 'custom.html');
        assertEqual(expected, fileSystem.readUtf8File.getCall(0).firstArg);
    });
    it('returns SourceFile with custom filename', () => {
        assertEqual('custom.html', result.filename);
        assertEqual('<div>Custom</div>', result.source);
    });
});

describe('PageStore#getPageTemplate() when readUtf8File returns null', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'page.html', isFile: true }]);
    fileSystem.readUtf8File.resolves(null);
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getPageTemplate('/blog/post');
    });

    it('returns null', () => assertEqual(null, result));
});

describe('PageStore#getMarkdownContent() when pathname resolves outside base directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getMarkdownContent('../../../etc');
    });

    it('returns empty array', () => assertArray(result) && assertEqual(0, result.length));
});

describe('PageStore#getMarkdownContent() when directory has markdown files', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([
        { name: 'body.md', isFile: true },
        { name: 'sidebar.md', isFile: true },
    ]);
    fileSystem.readUtf8File.onFirstCall().resolves('# Body content');
    fileSystem.readUtf8File.onSecondCall().resolves('## Sidebar');
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getMarkdownContent('/doc');
    });

    it('returns array of SourceFile objects', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual('body.md', result[0].filename);
        assertEqual('# Body content', result[0].source);
        assertEqual('sidebar.md', result[1].filename);
        assertEqual('## Sidebar', result[1].source);
    });
});

describe('PageStore#getMarkdownContent() when directory has no markdown files', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.readDirectory.resolves([{ name: 'page.html', isFile: true }]);
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.getMarkdownContent('/doc');
    });

    it('returns empty array', () => assertArray(result) && assertEqual(0, result.length));
});

describe('PageStore pathname with leading and trailing slashes', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves({ isDirectory: true });

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        await store.doesPageExist('/blog/post/');
    });

    it('resolves to correct directory', () => {
        const expected = path.resolve(THIS_DIR, 'blog', 'post');
        assertEqual(expected, fileSystem.getFileStats.getCall(0).firstArg);
    });
});
