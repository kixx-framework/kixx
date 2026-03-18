import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import StaticFileServerStore, { File } from '../../../../lib/hyperview/node-local-store/static-file-server-store.js';
import { testHyperviewStaticFileServerStoreConformance } from '../../../conformance/hyperview-static-file-server-store.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

testHyperviewStaticFileServerStoreConformance(() => {
    const fileSystem = {
        getFileStats: sinon.stub().resolves(null),
        createReadStream: sinon.stub().returns(null),
    };
    return new StaticFileServerStore({ publicDirectory: '/public', fileSystem });
}, {
    createExistingFileStore() {
        const fileSystem = {
            getFileStats: sinon.stub().resolves({
                size: 5,
                mtime: new Date('2025-01-15T10:00:00Z'),
                isFile: true,
            }),
            createReadStream: sinon.stub().returns(Readable.from([ Buffer.from('hello') ])),
        };
        return new StaticFileServerStore({ publicDirectory: '/public', fileSystem });
    },
    existingPathname: '/css/site.css',
});

function createMockFileSystem(overrides = {}) {
    return {
        getFileStats: sinon.stub(),
        createReadStream: sinon.stub(),
        ...overrides,
    };
}

describe('StaticFileServerStore constructor when options.publicDirectory is empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new StaticFileServerStore({ publicDirectory: '', fileSystem: createMockFileSystem() });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('StaticFileServerStore constructor when options.fileSystem is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new StaticFileServerStore({ publicDirectory: '/public' });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('StaticFileServerStore#getFile() when pathname resolves outside public directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    let result;

    before(async () => {
        const store = new StaticFileServerStore({ publicDirectory: THIS_DIR, fileSystem });
        result = await store.getFile('../../../etc/passwd');
    });

    it('returns null', () => assertEqual(null, result));
    it('does not call getFileStats', () => assertEqual(0, fileSystem.getFileStats.callCount));
});

describe('StaticFileServerStore#getFile() when file does not exist', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves(null);
    let result;

    before(async () => {
        const store = new StaticFileServerStore({ publicDirectory: THIS_DIR, fileSystem });
        result = await store.getFile('/css/style.css');
    });

    it('returns null', () => assertEqual(null, result));
});

describe('StaticFileServerStore#getFile() when path points to directory', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves({ isFile: false });
    let result;

    before(async () => {
        const store = new StaticFileServerStore({ publicDirectory: THIS_DIR, fileSystem });
        result = await store.getFile('/images');
    });

    it('returns null', () => assertEqual(null, result));
});

describe('StaticFileServerStore#getFile() when file exists and is regular file', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    const stats = { size: 1024, mtime: new Date('2025-01-15T10:00:00Z'), isFile: true };
    fileSystem.getFileStats.resolves(stats);
    fileSystem.createReadStream.returns(Readable.from([ Buffer.from('content') ]));
    let result;

    before(async () => {
        const store = new StaticFileServerStore({ publicDirectory: THIS_DIR, fileSystem });
        result = await store.getFile('/css/style.css');
    });

    it('returns File instance', () => assertEqual(true, result instanceof File));
    it('sets filepath on File', () => {
        const expected = path.resolve(THIS_DIR, 'css', 'style.css');
        assertEqual(expected, result.filepath);
    });
    it('exposes sizeBytes from stats', () => assertEqual(1024, result.sizeBytes));
    it('exposes modifiedDate from stats', () => assertEqual(stats.mtime, result.modifiedDate));
    it('sets contentType from extension', () => assertEqual('text/css', result.contentType));
});

describe('StaticFileServerStore#getFile() with pathname without leading slash', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    fileSystem.getFileStats.resolves({ size: 0, mtime: new Date(), isFile: true });
    fileSystem.createReadStream.returns(Readable.from([]));
    let result;

    before(async () => {
        const store = new StaticFileServerStore({ publicDirectory: THIS_DIR, fileSystem });
        result = await store.getFile('images/logo.png');
    });

    it('resolves path correctly', () => {
        const expected = path.resolve(THIS_DIR, 'images', 'logo.png');
        assertEqual(expected, result.filepath);
    });
});

describe('File#createReadStream()', ({ it }) => {
    const fileSystem = createMockFileSystem();
    const stream = Readable.from([ Buffer.from('data') ]);
    fileSystem.createReadStream.returns(stream);

    const file = new File({
        filepath: '/tmp/test.txt',
        stats: { size: 4, mtime: new Date() },
        fileSystem,
    });

    it('calls fileSystem.createReadStream with filepath', () => {
        file.createReadStream();
        assertEqual(1, fileSystem.createReadStream.callCount);
        assertEqual('/tmp/test.txt', fileSystem.createReadStream.getCall(0).firstArg);
    });
    it('returns the stream from fileSystem', () => assertEqual(stream, file.createReadStream()));
});

describe('File#computeHash()', ({ before, it }) => {
    const fileSystem = createMockFileSystem();
    const stream = Readable.from([ Buffer.from('hello') ]);
    fileSystem.createReadStream.returns(stream);

    const file = new File({
        filepath: '/tmp/foo.txt',
        stats: { size: 5, mtime: new Date() },
        fileSystem,
    });
    let hash;

    before(async () => {
        hash = await file.computeHash();
    });

    it('returns hex string', () => {
        assertEqual('string', typeof hash);
        assertEqual(32, hash.length);
        assertEqual(true, /^[a-f0-9]+$/.test(hash));
    });
});
