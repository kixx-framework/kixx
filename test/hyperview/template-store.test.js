import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import TemplateStore from '../../lib/hyperview/template-store.js';


// Get the directory containing this test file - used as the base directory
// for TemplateStore in all tests. This pattern works for both CommonJS and ES modules.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const baseTemplatesDirectory = path.join(THIS_DIR, 'fake-templates');
const helpersDirectory = path.join(baseTemplatesDirectory, 'helpers');
const partialsDirectory = path.join(baseTemplatesDirectory, 'partials');
const templatesDirectory = path.join(baseTemplatesDirectory, 'templates');

describe('TemplateStore#getBaseTemplate() with a single part templateId beginning with a slash, like "/base.html"', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<html>base template</html>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getBaseTemplate('/base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(templatesDirectory, 'base.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('/base.html', result.filename);
        assertEqual('<html>base template</html>', result.source);
    });
});

describe('TemplateStore#getBaseTemplate() with a nested templateId like "marketing/base.html"', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<html>marketing template</html>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getBaseTemplate('marketing/base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(templatesDirectory, 'marketing', 'base.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('marketing/base.html', result.filename);
        assertEqual('<html>marketing template</html>', result.source);
    });
});

describe('TemplateStore#getBaseTemplate() when the source does not exist', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves(null),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getBaseTemplate('nonexistent.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(templatesDirectory, 'nonexistent.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#getBaseTemplate() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        // Attempt to access parent directory
        result = await store.getBaseTemplate('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null for invalid path', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#getBaseTemplate() with path traversal using nested ".." segments', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        // Attempt to traverse with nested path
        result = await store.getBaseTemplate('layouts/../../outside.html');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null for invalid path', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#putBaseTemplate() with a valid templateId', ({ before, after, it }) => {

    let mockWriteStream;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    const chunks = [];

    before(async () => {
        // Create a readable stream with test data that ends immediately
        incomingStream = Readable.from([ 'template content' ]);

        // Create a writable stream that collects data
        mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });

        sinon.spy(mockWriteStream, 'write');

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        await store.putBaseTemplate('layouts/base.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the parent directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        const expectedPath = path.join(templatesDirectory, 'layouts');
        assertEqual(expectedPath, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(templatesDirectory, 'layouts', 'base.html');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });

    it('writes to the write stream', () => {
        assertEqual(1, mockWriteStream.write.callCount);
        assertEqual('template content', chunks.join(''));
    });
});


describe('TemplateStore#putBaseTemplate() with a nested templateId', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ 'marketing template content' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        await store.putBaseTemplate('marketing/pages/home.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the parent directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        const expectedPath = path.join(templatesDirectory, 'marketing', 'pages');
        assertEqual(expectedPath, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(templatesDirectory, 'marketing', 'pages', 'home.html');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('TemplateStore#putBaseTemplate() with path traversal attempt using ".."', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putBaseTemplate('../../etc/passwd', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call ensureDirectory()', () => {
        assertEqual(0, fileSystem.ensureDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#putBaseTemplate() with path traversal using nested ".." segments', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putBaseTemplate('layouts/../../outside.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call ensureDirectory()', () => {
        assertEqual(0, fileSystem.ensureDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#putBaseTemplate() with templateId starting with slash', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ 'base template content' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        await store.putBaseTemplate('/base.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the templates directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        assertEqual(templatesDirectory, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(templatesDirectory, 'base.html');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('TemplateStore#putBaseTemplate() when pipeline fails', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    const writeError = new Error('Write failed: disk full');

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'template content' ]);

        // Create a writable stream that errors on write
        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback(writeError);
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        try {
            result = await store.putBaseTemplate('layouts/base.html', incomingStream);
        } catch (error) {
            result = error;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() before the error', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
    });

    it('throws the pipeline error', () => {
        assertEqual('Error', result.name);
        assertEqual('Write failed: disk full', result.message);
    });
});


describe('TemplateStore#deleteBaseTemplate() with a valid templateId', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteBaseTemplate('base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(templatesDirectory, 'base.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the templateId', () => {
        assertEqual('base.html', result);
    });
});


describe('TemplateStore#deleteBaseTemplate() with a nested templateId', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteBaseTemplate('layouts/base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(templatesDirectory, 'layouts', 'base.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the templateId', () => {
        assertEqual('layouts/base.html', result);
    });
});


describe('TemplateStore#deleteBaseTemplate() with a non-existent template (idempotent behavior)', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteBaseTemplate('nonexistent.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(templatesDirectory, 'nonexistent.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the templateId', () => {
        assertEqual('nonexistent.html', result);
    });
});


describe('TemplateStore#deleteBaseTemplate() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteBaseTemplate('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call removeFile()', () => {
        assertEqual(0, fileSystem.removeFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#deleteBaseTemplate() with path traversal using nested ".." segments', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteBaseTemplate('layouts/../../outside.html');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call removeFile()', () => {
        assertEqual(0, fileSystem.removeFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#deleteBaseTemplate() with templateId starting with slash', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteBaseTemplate('/base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(templatesDirectory, 'base.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the templateId', () => {
        assertEqual('/base.html', result);
    });
});


describe('TemplateStore#getPartialFile() with a valid partialId', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<div>user card partial</div>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getPartialFile('header.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(partialsDirectory, 'header.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('header.html', result.filename);
        assertEqual('<div>user card partial</div>', result.source);
    });
});


describe('TemplateStore#getPartialFile() with a nested partialId', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<div>user card</div>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getPartialFile('cards/user.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(partialsDirectory, 'cards', 'user.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('cards/user.html', result.filename);
        assertEqual('<div>user card</div>', result.source);
    });
});


describe('TemplateStore#getPartialFile() when the partial does not exist', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves(null),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getPartialFile('nonexistent.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(partialsDirectory, 'nonexistent.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#getPartialFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getPartialFile('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null for invalid path', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#getPartialFile() with path traversal using nested ".." segments', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getPartialFile('cards/../../outside.html');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null for invalid path', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#getPartialFile() with partialId starting with slash', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<div>header</div>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getPartialFile('/header.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(partialsDirectory, 'header.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('/header.html', result.filename);
        assertEqual('<div>header</div>', result.source);
    });
});


describe('TemplateStore#putPartialFile() with a valid partialId', ({ before, after, it }) => {

    let mockWriteStream;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    const chunks = [];

    before(async () => {
        incomingStream = Readable.from([ 'partial content' ]);

        mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });

        sinon.spy(mockWriteStream, 'write');

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        await store.putPartialFile('header.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the partials directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        assertEqual(partialsDirectory, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(partialsDirectory, 'header.html');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });

    it('writes to the write stream', () => {
        assertEqual(1, mockWriteStream.write.callCount);
        assertEqual('partial content', chunks.join(''));
    });
});


describe('TemplateStore#putPartialFile() with a nested partialId', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ 'user card partial content' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        await store.putPartialFile('cards/user.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the parent directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        const expectedPath = path.join(partialsDirectory, 'cards');
        assertEqual(expectedPath, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(partialsDirectory, 'cards', 'user.html');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('TemplateStore#putPartialFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putPartialFile('../../etc/passwd', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call ensureDirectory()', () => {
        assertEqual(0, fileSystem.ensureDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#putPartialFile() with path traversal using nested ".." segments', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putPartialFile('cards/../../outside.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call ensureDirectory()', () => {
        assertEqual(0, fileSystem.ensureDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#putPartialFile() with partialId starting with slash', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ 'header partial content' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        await store.putPartialFile('/header.html', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the partials directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        assertEqual(partialsDirectory, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(partialsDirectory, 'header.html');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('TemplateStore#putPartialFile() when pipeline fails', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    const writeError = new Error('Write failed: disk full');

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'partial content' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback(writeError);
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        try {
            result = await store.putPartialFile('header.html', incomingStream);
        } catch (error) {
            result = error;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() before the error', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
    });

    it('throws the pipeline error', () => {
        assertEqual('Error', result.name);
        assertEqual('Write failed: disk full', result.message);
    });
});


describe('TemplateStore#deletePartialFile() with a valid partialId', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deletePartialFile('header.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(partialsDirectory, 'header.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the partialId', () => {
        assertEqual('header.html', result);
    });
});


describe('TemplateStore#deletePartialFile() with a nested partialId', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deletePartialFile('cards/user.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(partialsDirectory, 'cards', 'user.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the partialId', () => {
        assertEqual('cards/user.html', result);
    });
});


describe('TemplateStore#deletePartialFile() with a non-existent partial (idempotent behavior)', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deletePartialFile('nonexistent.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(partialsDirectory, 'nonexistent.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the partialId', () => {
        assertEqual('nonexistent.html', result);
    });
});


describe('TemplateStore#deletePartialFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deletePartialFile('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call removeFile()', () => {
        assertEqual(0, fileSystem.removeFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#deletePartialFile() with path traversal using nested ".." segments', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deletePartialFile('cards/../../outside.html');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call removeFile()', () => {
        assertEqual(0, fileSystem.removeFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('TemplateStore#deletePartialFile() with partialId starting with slash', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deletePartialFile('/header.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(partialsDirectory, 'header.html');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the partialId', () => {
        assertEqual('/header.html', result);
    });
});
// Tests for getHelperFile()

describe('TemplateStore#getHelperFile() with a valid helperId', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('export const name = "formatDate"; export function helper() { }'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getHelperFile('format-date.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(helpersDirectory, 'format-date.js');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('format-date.js', result.filename);
        assertEqual('export const name = "formatDate"; export function helper() { }', result.source);
    });
});

describe('TemplateStore#getHelperFile() when the helper does not exist', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves(null),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getHelperFile('nonexistent.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(helpersDirectory, 'nonexistent.js');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#getHelperFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getHelperFile('../../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#getHelperFile() with nested path attempt', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getHelperFile('formatters/date.js');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call readUtf8File()', () => {
        assertEqual(0, fileSystem.readUtf8File.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#getHelperFile() with helperId starting with slash', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('export const name = "helper"; export function helper() { }'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getHelperFile('/format-date.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the resolved filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(helpersDirectory, 'format-date.js');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('/format-date.js', result.filename);
        assertEqual('export const name = "helper"; export function helper() { }', result.source);
    });
});


// Tests for putHelperFile()

describe('TemplateStore#putHelperFile() with a valid helperId', ({ before, after, it }) => {

    let result;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    before(async () => {
        incomingStream = Readable.from([ 'export const name = "helper"; export function helper() { }' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        const store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putHelperFile('new-helper.js', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the helpers directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        assertEqual(helpersDirectory, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(helpersDirectory, 'new-helper.js');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });

    it('returns the helperId', () => {
        assertEqual('new-helper.js', result);
    });
});

describe('TemplateStore#putHelperFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    let result;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        const store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putHelperFile('../../../etc/passwd', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call ensureDirectory()', () => {
        assertEqual(0, fileSystem.ensureDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#putHelperFile() with nested path attempt', ({ before, after, it }) => {

    let result;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    before(async () => {
        incomingStream = Readable.from([ 'export const name = "helper"; export function helper() { }' ]);

        const store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putHelperFile('formatters/date.js', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('does not call ensureDirectory()', () => {
        assertEqual(0, fileSystem.ensureDirectory.callCount);
    });

    it('does not call createWriteStream()', () => {
        assertEqual(0, fileSystem.createWriteStream.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#putHelperFile() with helperId starting with slash', ({ before, after, it }) => {

    let result;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    before(async () => {
        incomingStream = Readable.from([ 'export const name = "helper"; export function helper() { }' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        const store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.putHelperFile('/format-date.js', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the helpers directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        assertEqual(helpersDirectory, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(helpersDirectory, 'format-date.js');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });

    it('returns the helperId', () => {
        assertEqual('/format-date.js', result);
    });
});

describe('TemplateStore#putHelperFile() when pipeline fails', ({ before, after, it }) => {

    let result;
    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    const writeError = new Error('Write failed: disk full');

    before(async () => {
        incomingStream = Readable.from([ 'export const name = "helper"; export function helper() { }' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback(writeError);
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        const store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        try {
            result = await store.putHelperFile('new-helper.js', incomingStream);
        } catch (error) {
            result = error;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() before the error', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
    });

    it('throws the pipeline error', () => {
        assertEqual('Error', result.name);
        assertEqual('Write failed: disk full', result.message);
    });
});


// Tests for deleteHelperFile()

describe('TemplateStore#deleteHelperFile() with a valid helperId', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteHelperFile('old-helper.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(helpersDirectory, 'old-helper.js');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the helperId', () => {
        assertEqual('old-helper.js', result);
    });
});

describe('TemplateStore#deleteHelperFile() with a non-existent helper (idempotent behavior)', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteHelperFile('nonexistent.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(helpersDirectory, 'nonexistent.js');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the helperId (succeeds silently)', () => {
        assertEqual('nonexistent.js', result);
    });
});

describe('TemplateStore#deleteHelperFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteHelperFile('../../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call removeFile()', () => {
        assertEqual(0, fileSystem.removeFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#deleteHelperFile() with nested path attempt', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteHelperFile('formatters/date.js');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call removeFile()', () => {
        assertEqual(0, fileSystem.removeFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('TemplateStore#deleteHelperFile() with helperId starting with slash', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.deleteHelperFile('/old-helper.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(helpersDirectory, 'old-helper.js');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the helperId', () => {
        assertEqual('/old-helper.js', result);
    });
});
