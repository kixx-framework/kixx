import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray, isPlainObject } from 'kixx-assert';

import PageStore from '../../lib/hyperview/page-store.js';


// Get the directory containing this test file - used as the base directory
// for PageStore in all tests. This pattern works for both CommonJS and ES modules.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));


describe('PageStore#doesPageExist() when stats isDirectory is true', ({ before, it }) => {
    const directory = THIS_DIR;

    const stats = {
        isDirectory: sinon.stub().returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(stats),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.doesPageExist('/blog/a-blog-post');
    });

    it('passes the full directory path to getFileStats()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.getFileStats.callCount);
        assertEqual(dirpath, fileSystem.getFileStats.getCall(0).firstArg);
    });

    it('calls isDirectory() on stats', () => {
        assertEqual(1, stats.isDirectory.callCount);
    });

    it('returns true', () => {
        assertEqual(true, result);
    });
});

describe('PageStore#doesPageExist() when stats is null', ({ before, it }) => {
    const directory = THIS_DIR;

    const stats = null;

    const fileSystem = {
        getFileStats: sinon.stub().resolves(stats),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Trailing slash should be normalized - tests path normalization behavior
        result = await store.doesPageExist('/blog/a-blog-post/');
    });

    it('passes the full directory path to getFileStats()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.getFileStats.callCount);
        assertEqual(dirpath, fileSystem.getFileStats.getCall(0).firstArg);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('PageStore#doesPageExist() when stats isDirectory is false', ({ before, it }) => {
    const directory = THIS_DIR;

    const stats = {
        isDirectory: sinon.stub().returns(false),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(stats),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.doesPageExist('/blog/a-blog-post');
    });

    it('passes the full directory path to getFileStats()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.getFileStats.callCount);
        assertEqual(dirpath, fileSystem.getFileStats.getCall(0).firstArg);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('PageStore#getPageData() with .json file', ({ before, it }) => {
    const directory = THIS_DIR;

    const data = { pageData: 1 };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
        ]),
        readJSONFile: sinon.stub().resolves(data),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageData('/blog/a-blog-post/');
    });

    it('passes the full directory to readDirectory()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(dirpath, fileSystem.readDirectory.getCall(0).firstArg);
    });

    it('passes the filepath to readJSONFile()', () => {
        const filepath = path.join(directory, 'blog', 'a-blog-post', 'page.json');
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(filepath, fileSystem.readJSONFile.getCall(0).firstArg);
    });

    it('returns the JSON', () => {
        assertEqual(data, result);
    });
});

describe('PageStore#getPageData() with .jsonc file', ({ before, it }) => {
    const directory = THIS_DIR;

    const data = { pageData: 1 };

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.jsonc',
                isFile() {
                    return true;
                },
            },
        ]),
        readJSONFile: sinon.fake.resolves(data),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageData('/blog/a-blog-post');
    });

    it('passes the full directory to readDirectory()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(dirpath, fileSystem.readDirectory.getCall(0).firstArg);
    });

    it('passes the filepath to readJSONFile()', () => {
        const filepath = path.join(directory, 'blog', 'a-blog-post', 'page.jsonc');
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(filepath, fileSystem.readJSONFile.getCall(0).firstArg);
    });

    it('returns the JSON', () => {
        assertEqual(data, result);
    });
});

describe('PageStore#getPageData() with no JSON file', ({ before, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.js',
                isFile() {
                    return true;
                },
            },
        ]),
        readJSONFile: sinon.fake.resolves({}),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageData('/blog/a-blog-post/');
    });

    it('does not call readJSONFile()', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
    });
});

describe('PageStore#getPageData() when the filepath is not a file', ({ before, it }) => {
    const directory = THIS_DIR;

    const data = { pageData: 1 };

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                // Simulates a directory entry that looks like a JSON file but isn't
                // a regular file (e.g., it's a symlink or other special file type)
                name: 'page.jsonc',
                isFile() {
                    return false;
                },
            },
        ]),
        readJSONFile: sinon.fake.resolves(data),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageData('/blog/a-blog-post');
    });

    it('does not call readJSONFile()', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
    });
});

describe('PageStore#getPageData() when file is deleted or renamed before it is read', ({ before, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
        ]),
        // Simulates a race condition where the file was deleted or renamed
        // between directory listing and reading, causing readJSONFile to return null
        readJSONFile: sinon.fake.resolves(null),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageData('/blog/a-blog-post');
    });

    it('calls readDirectory()', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
    });

    it('calls readJSONFile()', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
    });
});

describe('PageStore#getPageTemplate() with .html file', ({ before, it }) => {
    const directory = THIS_DIR;

    const source = '<html>';

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
        ]),
        readUtf8File: sinon.fake.resolves(source),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageTemplate('/blog/a-blog-post/');
    });

    it('passes the full directory to readDirectory()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(dirpath, fileSystem.readDirectory.getCall(0).firstArg);
    });

    it('passes the filepath to readUtf8File()', () => {
        const filepath = path.join(directory, 'blog', 'a-blog-post', 'page.html');
        assertEqual(1, fileSystem.readUtf8File.callCount);
        assertEqual(filepath, fileSystem.readUtf8File.getCall(0).firstArg);
    });

    it('returns the file object', () => {
        assertEqual('page.html', result.filename);
        assertEqual(source, result.source);
    });
});

describe('PageStore#getPageTemplate() with .xml file', ({ before, it }) => {
    const directory = THIS_DIR;

    const source = '<xml>';

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.xml',
                isFile() {
                    return true;
                },
            },
        ]),
        readUtf8File: sinon.fake.resolves(source),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageTemplate('/sitemap');
    });

    it('passes the full directory to readDirectory()', () => {
        const dirpath = path.join(directory, 'sitemap');
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(dirpath, fileSystem.readDirectory.getCall(0).firstArg);
    });

    it('passes the filepath to readUtf8File()', () => {
        const filepath = path.join(directory, 'sitemap', 'page.xml');
        assertEqual(1, fileSystem.readUtf8File.callCount);
        assertEqual(filepath, fileSystem.readUtf8File.getCall(0).firstArg);
    });

    it('returns the file object', () => {
        assertEqual('page.xml', result.filename);
        assertEqual(source, result.source);
    });
});

describe('PageStore#getPageTemplate() with no template file', ({ before, it }) => {
    const directory = THIS_DIR;

    const source = '<xml>';

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.yaml',
                isFile() {
                    return true;
                },
            },
        ]),
        readUtf8File: sinon.fake.resolves(source),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageTemplate('/blog/a-blog-post');
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#getPageTemplate() when the template file is not a file', ({ before, it }) => {
    const directory = THIS_DIR;

    const source = '<xml>';

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return false;
                },
            },
        ]),
        readUtf8File: sinon.fake.resolves(source),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageTemplate('/blog/a-blog-post');
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#getPageTemplate() when file is deleted or renamed before it is read', ({ before, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
        ]),
        // Simulates a race condition where the file was deleted or renamed
        // between directory listing and reading, causing readUtf8File to return null
        readUtf8File: sinon.fake.resolves(null),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getPageTemplate('/blog/a-blog-post');
    });

    it('calls readDirectory()', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
    });

    it('calls readUtf8File()', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#getMarkdownContent() with markdown files', ({ before, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'body.md',
                isFile() {
                    return true;
                },
            },
            {
                name: 'docs.md',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
        ]),
        // Use stub with onCall() to return different content for each markdown file
        // since getMarkdownContent() processes multiple files in sequence
        readUtf8File: sinon.stub()
            .onCall(0).resolves('# Introduction')
            .onCall(1).resolves('# Documentation'),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getMarkdownContent('/documentation');
    });

    it('passes the full directory to readDirectory()', () => {
        const dirpath = path.join(directory, 'documentation');
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(dirpath, fileSystem.readDirectory.getCall(0).firstArg);
    });

    it('calls readUtf8File() for each markdown file', () => {
        assertEqual(2, fileSystem.readUtf8File.callCount);
        const filepath1 = path.join(directory, 'documentation', 'body.md');
        const filepath2 = path.join(directory, 'documentation', 'docs.md');
        assertEqual(filepath1, fileSystem.readUtf8File.getCall(0).firstArg);
        assertEqual(filepath2, fileSystem.readUtf8File.getCall(1).firstArg);
    });

    it('returns sources', () => {
        assertArray(result);
        assertEqual('body.md', result[0].filename);
        assertEqual('# Introduction', result[0].source);
        assertEqual('docs.md', result[1].filename);
        assertEqual('# Documentation', result[1].source);
    });
});

describe('PageStore#getMarkdownContent() with no markdown files', ({ before, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
        ]),
        readUtf8File: sinon.spy(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getMarkdownContent('/documentation');
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns an empty array', () => {
        assertArray(result);
        assertEqual(0, result.length);
    });
});

describe('PageStore#getMarkdownContent() when some files are deleted or renamed before they are read', ({ before, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.fake.resolves([
            {
                name: 'page.html',
                isFile() {
                    return true;
                },
            },
            {
                name: 'intro.md',
                isFile() {
                    return true;
                },
            },
            {
                name: 'body.md',
                isFile() {
                    return true;
                },
            },
            {
                name: 'footer.md',
                isFile() {
                    return true;
                },
            },
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
        ]),
        // Simulates a race condition where body.md was deleted or renamed
        // between directory listing and reading, causing readUtf8File to return null
        readUtf8File: sinon.stub()
            .onCall(0).resolves('# Introduction')
            .onCall(1).resolves(null)
            .onCall(2).resolves('# Footer'),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.getMarkdownContent('/documentation');
    });

    it('calls readDirectory()', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
    });

    it('calls readUtf8File() for each markdown file', () => {
        assertEqual(3, fileSystem.readUtf8File.callCount);
        const filepath1 = path.join(directory, 'documentation', 'intro.md');
        const filepath2 = path.join(directory, 'documentation', 'body.md');
        const filepath3 = path.join(directory, 'documentation', 'footer.md');
        assertEqual(filepath1, fileSystem.readUtf8File.getCall(0).firstArg);
        assertEqual(filepath2, fileSystem.readUtf8File.getCall(1).firstArg);
        assertEqual(filepath3, fileSystem.readUtf8File.getCall(2).firstArg);
    });

    it('returns only successfully read files', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual('intro.md', result[0].filename);
        assertEqual('# Introduction', result[0].source);
        assertEqual('footer.md', result[1].filename);
        assertEqual('# Footer', result[1].source);
    });
});

describe('PageStore#doesPageExist() with path traversal attempt using ".."', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        getFileStats: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to access parent directory
        result = await store.doesPageExist('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getFileStats()', () => {
        assertEqual(0, fileSystem.getFileStats.callCount);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('PageStore#doesPageExist() with path traversal using nested ".." segments', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        getFileStats: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to traverse with nested path
        result = await store.doesPageExist('blog/../../outside');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getFileStats()', () => {
        assertEqual(0, fileSystem.getFileStats.callCount);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('PageStore#getPageData() with path traversal attempt using ".."', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.stub(),
        readJSONFile: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to access parent directory
        result = await store.getPageData('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call readJSONFile()', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
        assertEqual(0, Object.keys(result).length);
    });
});

describe('PageStore#getPageData() with path traversal using nested ".." segments', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.stub(),
        readJSONFile: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to traverse with nested path
        result = await store.getPageData('blog/../../outside');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call readJSONFile()', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
        assertEqual(0, Object.keys(result).length);
    });
});

describe('PageStore#getPageTemplate() with path traversal attempt using ".."', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.stub(),
        readUtf8File: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to access parent directory
        result = await store.getPageTemplate('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#getPageTemplate() with path traversal using nested ".." segments', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.stub(),
        readUtf8File: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to traverse with nested path
        result = await store.getPageTemplate('blog/../../outside');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#getMarkdownContent() with path traversal attempt using ".."', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.stub(),
        readUtf8File: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to access parent directory
        result = await store.getMarkdownContent('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns an empty array', () => {
        assertArray(result);
        assertEqual(0, result.length);
    });
});

describe('PageStore#getMarkdownContent() with path traversal using nested ".." segments', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const fileSystem = {
        readDirectory: sinon.stub(),
        readUtf8File: sinon.stub(),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        // Attempt to traverse with nested path
        result = await store.getMarkdownContent('blog/../../outside');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns an empty array', () => {
        assertArray(result);
        assertEqual(0, result.length);
    });
});

describe('PageStore#putPageData() with a valid pathname', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let mockWriteStream;
    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        createWriteStream: sinon.stub(),
    };

    let store;

    const chunks = [];

    before(async () => {
        // Create a readable stream with test data that ends immediately
        incomingStream = Readable.from([ '{"key": "value"}' ]);

        // Create a writable stream that collects data
        mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });

        sinon.spy(mockWriteStream, 'write');

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new PageStore({ directory, fileSystem });

        await store.putPageData('/blog/a-blog-post', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls readDirectory() to check for existing JSON files', () => {
        const dirpath = path.resolve(path.join(directory, 'blog', 'a-blog-post'));
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(dirpath, fileSystem.readDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with page.jsonc (default when no file exists)', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(directory, 'blog', 'a-blog-post', 'page.jsonc'));
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });

    it('writes to the write stream', () => {
        assertEqual(1, mockWriteStream.write.callCount);
        assertEqual('{"key": "value"}', chunks.join(''));
    });
});

describe('PageStore#putPageData() with existing page.json file', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'page.json',
                isFile() {
                    return true;
                },
            },
        ]),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ '{"data": "content"}' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new PageStore({ directory, fileSystem });

        await store.putPageData('/blog/a-blog-post', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls createWriteStream() with page.json (existing file)', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(directory, 'blog', 'a-blog-post', 'page.json'));
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});

describe('PageStore#putPageData() with existing page.jsonc file', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'page.jsonc',
                isFile() {
                    return true;
                },
            },
        ]),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ '{"data": "content"}' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new PageStore({ directory, fileSystem });

        await store.putPageData('/blog/a-blog-post', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls createWriteStream() with page.jsonc (existing file)', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(directory, 'blog', 'a-blog-post', 'page.jsonc'));
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});

describe('PageStore#putPageData() with a nested pathname', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ '{"nested": "data"}' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new PageStore({ directory, fileSystem });

        await store.putPageData('/documentation/api/reference', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(directory, 'documentation', 'api', 'reference', 'page.jsonc'));
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});

describe('PageStore#putPageData() with path traversal attempt using ".."', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ '{"malicious": "content"}' ]);

        store = new PageStore({ directory, fileSystem });

        result = await store.putPageData('../../etc/passwd', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#putPageData() with path traversal using nested ".." segments', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ '{"malicious": "content"}' ]);

        store = new PageStore({ directory, fileSystem });

        result = await store.putPageData('blog/../../outside', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readDirectory()', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('PageStore#putPageData() when pipeline fails', ({ before, after, it }) => {
    const directory = THIS_DIR;

    let incomingStream;

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        createWriteStream: sinon.stub(),
    };

    const writeError = new Error('Write failed: disk full');

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ '{"data": "content"}' ]);

        // Create a writable stream that errors on write
        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback(writeError);
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new PageStore({ directory, fileSystem });

        try {
            result = await store.putPageData('/blog/a-blog-post', incomingStream);
        } catch (error) {
            result = error;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws the pipeline error', () => {
        assertEqual('Error', result.name);
        assertEqual('Write failed: disk full', result.message);
    });
});
