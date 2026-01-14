import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import StaticFileServerStore, { File } from '../../lib/hyperview/static-file-server-store.js';


// Get the directory containing this test file
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const publicDirectory = path.join(THIS_DIR, 'fake-public');


describe('File constructor', ({ it }) => {

    const mockStats = {
        size: 2048,
        mtime: new Date('2025-01-15'),
    };

    const mockFileSystem = {
        createReadStream: sinon.stub(),
    };

    const config = {
        filepath: '/var/www/public/images/logo.png',
        stats: mockStats,
        fileSystem: mockFileSystem,
    };

    const file = new File(config);

    it('sets the filepath property', () => {
        assertEqual('/var/www/public/images/logo.png', file.filepath);
    });

    it('sets the filepath property as enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(file, 'filepath');
        assertEqual(true, descriptor.enumerable);
    });

    it('sets the filepath property as non-writable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(file, 'filepath');
        assertEqual(false, descriptor.writable);
        assertEqual(undefined, descriptor.set);
    });
});


describe('File#sizeBytes getter', ({ it }) => {

    const mockStats = {
        size: 4096,
        mtime: new Date('2025-01-15'),
    };

    const mockFileSystem = {
        createReadStream: sinon.stub(),
    };

    const file = new File({
        filepath: '/var/www/public/data.json',
        stats: mockStats,
        fileSystem: mockFileSystem,
    });

    it('returns the size from the stats object', () => {
        assertEqual(4096, file.sizeBytes);
    });
});


describe('File#modifiedDate getter', ({ it }) => {

    const modifiedDate = new Date('2025-01-15T10:30:00Z');

    const mockStats = {
        size: 1024,
        mtime: modifiedDate,
    };

    const mockFileSystem = {
        createReadStream: sinon.stub(),
    };

    const file = new File({
        filepath: '/var/www/public/script.js',
        stats: mockStats,
        fileSystem: mockFileSystem,
    });

    it('returns the mtime from the stats object', () => {
        assertEqual(modifiedDate, file.modifiedDate);
    });
});


describe('File#contentType getter with .css extension', ({ it }) => {

    const mockStats = {
        size: 512,
        mtime: new Date('2025-01-15'),
    };

    const mockFileSystem = {
        createReadStream: sinon.stub(),
    };

    const file = new File({
        filepath: '/var/www/public/styles/main.css',
        stats: mockStats,
        fileSystem: mockFileSystem,
    });

    it('returns "text/css"', () => {
        assertEqual('text/css', file.contentType);
    });
});


describe('File#contentType getter with .js extension', ({ it }) => {

    const mockStats = {
        size: 512,
        mtime: new Date('2025-01-15'),
    };

    const mockFileSystem = {
        createReadStream: sinon.stub(),
    };

    const file = new File({
        filepath: '/var/www/public/app.js',
        stats: mockStats,
        fileSystem: mockFileSystem,
    });

    it('returns "text/javascript"', () => {
        assertEqual('text/javascript', file.contentType);
    });
});


describe('File#contentType getter with .png extension', ({ it }) => {

    const mockStats = {
        size: 512,
        mtime: new Date('2025-01-15'),
    };

    const mockFileSystem = {
        createReadStream: sinon.stub(),
    };

    const file = new File({
        filepath: '/var/www/public/images/photo.png',
        stats: mockStats,
        fileSystem: mockFileSystem,
    });

    it('returns "image/png"', () => {
        assertEqual('image/png', file.contentType);
    });
});


describe('File#createReadStream()', ({ before, after, it }) => {

    const mockReadStream = { pipe: sinon.stub() };

    const mockStats = {
        size: 1024,
        mtime: new Date('2025-01-15'),
    };

    const mockFileSystem = {
        createReadStream: sinon.stub().returns(mockReadStream),
    };

    let file;
    let result;

    before(() => {
        file = new File({
            filepath: '/var/www/public/document.pdf',
            stats: mockStats,
            fileSystem: mockFileSystem,
        });

        result = file.createReadStream();
    });

    after(() => {
        sinon.restore();
    });

    it('calls fileSystem.createReadStream() with the filepath', () => {
        assertEqual(1, mockFileSystem.createReadStream.callCount);
        assertEqual('/var/www/public/document.pdf', mockFileSystem.createReadStream.firstCall.firstArg);
    });

    it('returns the read stream from fileSystem.createReadStream()', () => {
        assertEqual(mockReadStream, result);
    });
});


describe('File#computeHash()', ({ before, after, it }) => {

    const mockStats = {
        size: 2048,
        mtime: new Date('2025-01-15'),
    };

    let mockFileSystem;
    let file;
    let result;

    before(async () => {
        // Create a readable stream with known content for hashing
        const testStream = Readable.from([ 'test content' ]);

        mockFileSystem = {
            createReadStream: sinon.stub().returns(testStream),
        };

        file = new File({
            filepath: '/var/www/public/bundle.js',
            stats: mockStats,
            fileSystem: mockFileSystem,
        });

        result = await file.computeHash();
    });

    after(() => {
        sinon.restore();
    });

    it('calls fileSystem.createReadStream() with the filepath', () => {
        assertEqual(1, mockFileSystem.createReadStream.callCount);
        assertEqual('/var/www/public/bundle.js', mockFileSystem.createReadStream.firstCall.firstArg);
    });

    it('returns the MD5 hash as a 32-character hexadecimal string', () => {
        // MD5 hash of "test content"
        assertEqual('9473fdd0d880a43c21b7778d34872157', result);
    });
});


describe('StaticFileServerStore#getFile() with a valid file in public directory', ({ before, after, it }) => {

    const mockStats = {
        size: 1024,
        mtime: new Date('2025-01-01'),
        isFile: sinon.stub().returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(mockStats),
        createReadStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.getFile('css/style.css');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFileStats() with the resolved filepath', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const expectedPath = path.join(publicDirectory, 'css', 'style.css');
        assertEqual(expectedPath, fileSystem.getFileStats.firstCall.firstArg);
    });

    it('calls isFile() on the stats object', () => {
        assertEqual(1, mockStats.isFile.callCount);
    });

    it('returns a File instance with the filepath property set to the resolvedFilepath', () => {
        const expectedPath = path.join(publicDirectory, 'css', 'style.css');
        assertEqual(expectedPath, result.filepath);
    });
});


describe('StaticFileServerStore#getFile() with a nested subdirectory path', ({ before, after, it }) => {

    const mockStats = {
        size: 2048,
        mtime: new Date('2025-01-02'),
        isFile: sinon.stub().returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(mockStats),
        createReadStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.getFile('images/icons/logo.png');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFileStats() with the resolved filepath', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const expectedPath = path.join(publicDirectory, 'images', 'icons', 'logo.png');
        assertEqual(expectedPath, fileSystem.getFileStats.firstCall.firstArg);
    });

    it('returns a File instance', () => {
        const expectedPath = path.join(publicDirectory, 'images', 'icons', 'logo.png');
        assertEqual(expectedPath, result.filepath);
        assertEqual(2048, result.sizeBytes);
    });
});


describe('StaticFileServerStore#getFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        getFileStats: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        // Attempt to access parent directory
        result = await store.getFile('../../etc/passwd');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getFileStats()', () => {
        assertEqual(0, fileSystem.getFileStats.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('StaticFileServerStore#getFile() with path traversal using nested ".." segments', ({ before, after, it }) => {

    const fileSystem = {
        getFileStats: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        // Attempt to traverse with nested path
        result = await store.getFile('css/../../outside.txt');
    });

    after(() => {
        sinon.restore();
    });

    it('does not call getFileStats()', () => {
        assertEqual(0, fileSystem.getFileStats.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('StaticFileServerStore#getFile() when the file is a directory', ({ before, after, it }) => {

    const mockStats = {
        isFile: sinon.stub().returns(false),
        isDirectory: sinon.stub().returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(mockStats),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.getFile('css');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFileStats() with the resolved filepath', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const expectedPath = path.join(publicDirectory, 'css');
        assertEqual(expectedPath, fileSystem.getFileStats.firstCall.firstArg);
    });

    it('calls isFile() on the stats object', () => {
        assertEqual(1, mockStats.isFile.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('StaticFileServerStore#getFile() when the file does not exist', ({ before, after, it }) => {

    const fileSystem = {
        getFileStats: sinon.stub().resolves(null),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.getFile('nonexistent.css');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFileStats() with the resolved filepath', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const expectedPath = path.join(publicDirectory, 'nonexistent.css');
        assertEqual(expectedPath, fileSystem.getFileStats.firstCall.firstArg);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('StaticFileServerStore#getFile() with pathname starting with slash', ({ before, after, it }) => {

    const mockStats = {
        size: 512,
        mtime: new Date('2025-01-03'),
        isFile: sinon.stub().returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(mockStats),
        createReadStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.getFile('/js/app.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getFileStats() with the resolved filepath', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const expectedPath = path.join(publicDirectory, 'js', 'app.js');
        assertEqual(expectedPath, fileSystem.getFileStats.firstCall.firstArg);
    });

    it('returns a File instance', () => {
        const expectedPath = path.join(publicDirectory, 'js', 'app.js');
        assertEqual(expectedPath, result.filepath);
    });
});


describe('StaticFileServerStore#putFile() with a valid file pathname', ({ before, after, it }) => {

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
        incomingStream = Readable.from([ 'test file content' ]);

        // Create a writable stream that collects data
        mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });

        sinon.spy(mockWriteStream, 'write');

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        await store.putFile('css/style.css', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the parent directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        const expectedPath = path.join(publicDirectory, 'css');
        assertEqual(expectedPath, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(publicDirectory, 'css', 'style.css');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });

    it('writes to the write stream', () => {
        assertEqual(1, mockWriteStream.write.callCount);
        assertEqual('test file content', chunks.join(''));
    });
});


describe('StaticFileServerStore#putFile() with a nested subdirectory path', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ 'image data' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        await store.putFile('images/icons/logo.png', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the parent directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        const expectedPath = path.join(publicDirectory, 'images', 'icons');
        assertEqual(expectedPath, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(publicDirectory, 'images', 'icons', 'logo.png');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('StaticFileServerStore#putFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.putFile('../../etc/passwd', incomingStream);
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


describe('StaticFileServerStore#putFile() with path traversal using nested ".." segments', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'malicious content' ]);

        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.putFile('css/../../outside.txt', incomingStream);
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


describe('StaticFileServerStore#putFile() with pathname starting with slash', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    let store;

    before(async () => {
        incomingStream = Readable.from([ 'javascript code' ]);

        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback();
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        await store.putFile('/js/app.js', incomingStream);
    });

    after(() => {
        sinon.restore();
    });

    it('calls ensureDirectory() with the parent directory', () => {
        assertEqual(1, fileSystem.ensureDirectory.callCount);
        const expectedPath = path.join(publicDirectory, 'js');
        assertEqual(expectedPath, fileSystem.ensureDirectory.firstCall.firstArg);
    });

    it('calls createWriteStream() with the resolved filepath', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const expectedPath = path.join(publicDirectory, 'js', 'app.js');
        assertEqual(expectedPath, fileSystem.createWriteStream.firstCall.firstArg);
    });
});


describe('StaticFileServerStore#putFile() when pipeline fails', ({ before, after, it }) => {

    let incomingStream;

    const fileSystem = {
        ensureDirectory: sinon.stub().resolves(),
        createWriteStream: sinon.stub(),
    };

    const writeError = new Error('Write failed: disk full');

    let store;
    let result;

    before(async () => {
        incomingStream = Readable.from([ 'test content' ]);

        // Create a writable stream that errors on write
        const mockWriteStream = new Writable({
            write(chunk, encoding, callback) {
                callback(writeError);
            },
        });

        fileSystem.createWriteStream.returns(mockWriteStream);

        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        try {
            result = await store.putFile('css/style.css', incomingStream);
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


describe('StaticFileServerStore#deleteFile() with a valid file in public directory', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.deleteFile('css/style.css');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(publicDirectory, 'css', 'style.css');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the pathname', () => {
        assertEqual('css/style.css', result);
    });
});


describe('StaticFileServerStore#deleteFile() with a nested subdirectory path', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.deleteFile('images/icons/logo.png');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(publicDirectory, 'images', 'icons', 'logo.png');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the pathname', () => {
        assertEqual('images/icons/logo.png', result);
    });
});


describe('StaticFileServerStore#deleteFile() when the file does not exist (idempotent)', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.deleteFile('nonexistent.txt');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(publicDirectory, 'nonexistent.txt');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the pathname (succeeds silently)', () => {
        assertEqual('nonexistent.txt', result);
    });
});


describe('StaticFileServerStore#deleteFile() with path traversal attempt using ".."', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.deleteFile('../../etc/passwd');
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


describe('StaticFileServerStore#deleteFile() with path traversal using nested ".." segments', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.deleteFile('css/../../outside.txt');
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


describe('StaticFileServerStore#deleteFile() with pathname starting with slash', ({ before, after, it }) => {

    const fileSystem = {
        removeFile: sinon.stub().resolves(),
    };

    let store;
    let result;

    before(async () => {
        store = new StaticFileServerStore({
            publicDirectory,
            fileSystem,
        });

        result = await store.deleteFile('/js/app.js');
    });

    after(() => {
        sinon.restore();
    });

    it('calls removeFile() with the resolved filepath', () => {
        assertEqual(1, fileSystem.removeFile.callCount);
        const expectedPath = path.join(publicDirectory, 'js', 'app.js');
        assertEqual(expectedPath, fileSystem.removeFile.firstCall.firstArg);
    });

    it('returns the pathname', () => {
        assertEqual('/js/app.js', result);
    });
});
