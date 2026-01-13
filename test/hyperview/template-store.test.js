import path from 'node:path';
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
        createWriteStream: sinon.stub(),
    };

    let store;

    const chunks = [];

    before(async () => {
        const { Readable, Writable } = await import('node:stream');

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

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(templatesDirectory, 'layouts', 'base.html'));
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
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        const { Readable, Writable } = await import('node:stream');

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

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(templatesDirectory, 'marketing', 'pages', 'home.html'));
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('TemplateStore#putBaseTemplate() with path traversal attempt using ".."', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        const { Readable } = await import('node:stream');

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
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        const { Readable } = await import('node:stream');

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
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        const { Readable, Writable } = await import('node:stream');

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

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.resolve(path.join(templatesDirectory, 'base.html'));
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('TemplateStore#putBaseTemplate() when pipeline fails', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        createWriteStream: sinon.stub(),
    };

    const writeError = new Error('Write failed: disk full');

    let store;
    let result;

    before(async () => {
        const { Readable, Writable } = await import('node:stream');

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
        const expectedPath = path.resolve(path.join(templatesDirectory, 'base.html'));
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
        const expectedPath = path.resolve(path.join(templatesDirectory, 'layouts', 'base.html'));
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
        const expectedPath = path.resolve(path.join(templatesDirectory, 'nonexistent.html'));
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
        const expectedPath = path.resolve(path.join(templatesDirectory, 'base.html'));
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the templateId', () => {
        assertEqual('/base.html', result);
    });
});
