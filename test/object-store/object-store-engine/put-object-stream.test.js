import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import EventEmitter from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertUndefined, assertMatches } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStoreEngine from '../../../object-store/object-store-engine.js';

const MD5_PATTERN = /^[0-9a-f]{32}$/;
const HTTP_DATE_PATTERN = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const CONTENT_LEN_PATTERN = /^[\d]+$/;


const thisFilepath = fileURLToPath(import.meta.url);
const thisDirectory = path.dirname(thisFilepath);


class Logger {
    debug() {}
    info() {}
    warn() {}
    error() {}
}


describe('ObjectStoreEngine:putObjectStream when object exists', ({ before, it }) => {
    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
    };

    const existingHeaders = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
        'ETag': '123',
        'Last-Modified': new Date().toUTCString(),
    };

    const fileSystem = {
        createWriteStream: sinon.fake((filepath, opts) => {
            return fs.createWriteStream(filepath, opts);
        }),
        getFileStats: sinon.fake.resolves({}),
        readJSONFile: sinon.fake.resolves(existingHeaders),
        rename: sinon.fake.resolves(),
        writeJSONFile: sinon.fake.resolves(),
    };

    const logger = new Logger();

    const sourceStream = fs.createReadStream(thisFilepath);

    let returnValue;

    before(async () => {
        const engine = new ObjectStoreEngine({
            logger,
            fileSystem,
            directory: thisDirectory,
        });

        returnValue = await engine.putObjectStream(sourceStream, new Headers(headers));
    });

    it('creates a temporary write stream', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const filepath = fileSystem.createWriteStream.firstCall.args[0];
        const opts = fileSystem.createWriteStream.firstCall.args[1];
        assertEqual(os.tmpdir(), path.dirname(filepath));
        assertEqual(null, opts.encoding);
    });

    it('does NOT move the temporary file to the object store', () => {
        assertEqual(0, fileSystem.rename.callCount);
    });

    it('checks to see if the object file already exists', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const filepath = fileSystem.getFileStats.firstCall.args[0];
        assertMatches(MD5_PATTERN, path.basename(filepath));
    });

    it('reads the headers file', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
        const filepath = fileSystem.readJSONFile.firstCall.args[0];
        const [ id, filename ] = path.basename(filepath).split('__');
        assertEqual(thisDirectory, path.dirname(filepath));
        assertEqual('headers.json', filename);
        assertMatches(MD5_PATTERN, id);
    });

    it('does NOT write the new headers file', () => {
        assertEqual(0, fileSystem.writeJSONFile.callCount);
    });

    it('returns the existing headers', () => {
        assertEqual(null, returnValue.get('x-kixx-new-object'));
        assertEqual('image/jpeg', returnValue.get('content-type'));
        assertEqual('45', returnValue.get('content-length'));
        assertEqual('123', returnValue.get('etag'));
        assertMatches(HTTP_DATE_PATTERN, returnValue.get('last-modified'));
    });
});

describe('ObjectStoreEngine:putObjectStream with writeStream error', ({ before, after, it }) => {
    let sandbox;

    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
    };

    const fileSystem = {
        createWriteStream: sinon.fake(() => {
            const writeStream = new EventEmitter();
            setTimeout(() => {
                writeStream.emit('error', new Error('write stream error'));
            }, 0);
            return writeStream;
        }),
        getFileStats: sinon.fake.resolves(null),
        readJSONFile: sinon.fake.resolves(null),
        rename: sinon.fake.resolves(),
        writeJSONFile: sinon.fake.resolves(),
    };

    const logger = new Logger();

    const sourceStream = new EventEmitter();
    sourceStream.pipe = sinon.fake.returns();

    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        sandbox.replace(logger, 'warn', sinon.fake.returns());

        const engine = new ObjectStoreEngine({
            logger,
            fileSystem,
            directory: thisDirectory,
        });

        try {
            await engine.putObjectStream(sourceStream, new Headers(headers));
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('creates a temporary write stream', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const filepath = fileSystem.createWriteStream.firstCall.args[0];
        const opts = fileSystem.createWriteStream.firstCall.args[1];
        assertEqual(os.tmpdir(), path.dirname(filepath));
        assertEqual(null, opts.encoding);
    });

    it('does NOT move the temporary file to the object store', () => {
        assertEqual(0, fileSystem.rename.callCount);
    });

    it('does not check to see if the object file already exists', () => {
        assertEqual(0, fileSystem.getFileStats.callCount);
    });

    it('does not read the headers file', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('does NOT write the new headers file', () => {
        assertEqual(0, fileSystem.writeJSONFile.callCount);
    });

    it('logs a warning', () => {
        assertEqual(1, logger.warn.callCount);
        assertEqual('object write stream error event', logger.warn.firstCall.args[0]);
    });

    it('throws an error', () => {
        assertEqual('write stream error', error.cause.message);
    });
});

describe('ObjectStoreEngine:putObjectStream with sourceStream error', ({ before, after, it }) => {
    let sandbox;

    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
    };

    const fileSystem = {
        createWriteStream: sinon.fake((filepath, opts) => {
            return fs.createWriteStream(filepath, opts);
        }),
        getFileStats: sinon.fake.resolves(null),
        readJSONFile: sinon.fake.resolves(null),
        rename: sinon.fake.resolves(),
        writeJSONFile: sinon.fake.resolves(),
    };

    const logger = new Logger();

    const sourceStream = new EventEmitter();
    sourceStream.pipe = sinon.fake.returns();

    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        sandbox.replace(logger, 'warn', sinon.fake.returns());

        const engine = new ObjectStoreEngine({
            logger,
            fileSystem,
            directory: thisDirectory,
        });

        setTimeout(() => {
            sourceStream.emit('error', new Error('source stream error'));
        }, 0);

        try {
            await engine.putObjectStream(sourceStream, new Headers(headers));
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('creates a temporary write stream', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const filepath = fileSystem.createWriteStream.firstCall.args[0];
        const opts = fileSystem.createWriteStream.firstCall.args[1];
        assertEqual(os.tmpdir(), path.dirname(filepath));
        assertEqual(null, opts.encoding);
    });

    it('does NOT move the temporary file to the object store', () => {
        assertEqual(0, fileSystem.rename.callCount);
    });

    it('does not check to see if the object file already exists', () => {
        assertEqual(0, fileSystem.getFileStats.callCount);
    });

    it('does not read the headers file', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('does NOT write the new headers file', () => {
        assertEqual(0, fileSystem.writeJSONFile.callCount);
    });

    it('logs a warning', () => {
        assertEqual(1, logger.warn.callCount);
        assertEqual('object source stream error event', logger.warn.firstCall.args[0]);
    });

    it('throws an error', () => {
        assertEqual('source stream error', error.cause.message);
    });
});

describe('ObjectStoreEngine:putObjectStream', ({ before, it }) => {
    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
    };

    const fileSystem = {
        createWriteStream: sinon.fake((filepath, opts) => {
            return fs.createWriteStream(filepath, opts);
        }),
        getFileStats: sinon.fake.resolves(null),
        readJSONFile: sinon.fake.resolves(null),
        rename: sinon.fake.resolves(),
        writeJSONFile: sinon.fake.resolves(),
    };

    const logger = new Logger();

    const sourceStream = fs.createReadStream(thisFilepath);

    let returnValue;

    before(async () => {
        const engine = new ObjectStoreEngine({
            logger,
            fileSystem,
            directory: thisDirectory,
        });

        returnValue = await engine.putObjectStream(sourceStream, new Headers(headers));
    });

    it('creates a temporary write stream', () => {
        assertEqual(1, fileSystem.createWriteStream.callCount);
        const filepath = fileSystem.createWriteStream.firstCall.args[0];
        const opts = fileSystem.createWriteStream.firstCall.args[1];
        assertEqual(os.tmpdir(), path.dirname(filepath));
        assertEqual(null, opts.encoding);
    });

    it('moves the temporary file to the object store', () => {
        assertEqual(1, fileSystem.rename.callCount);
        const fromFilepath = fileSystem.rename.firstCall.args[0];
        const toFilepath = fileSystem.rename.firstCall.args[1];
        assertEqual(os.tmpdir(), path.dirname(fromFilepath));
        const objectId = returnValue.get('etag');
        assertEqual(path.join(thisDirectory, objectId), toFilepath);
    });

    it('checks to see if the object file already exists', () => {
        assertEqual(1, fileSystem.getFileStats.callCount);
        const filepath = fileSystem.getFileStats.firstCall.args[0];
        const objectId = returnValue.get('etag');
        assertEqual(path.join(thisDirectory, objectId), filepath);
    });

    // getFileStats() returns null, so the object does not exist.
    it('does not read the headers file', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('writes the new headers file', () => {
        assertEqual(1, fileSystem.writeJSONFile.callCount);
        const filepath = fileSystem.writeJSONFile.firstCall.args[0];
        const obj = fileSystem.writeJSONFile.firstCall.args[1];
        const objectId = returnValue.get('etag');
        assertEqual(path.join(thisDirectory, `${ objectId }__headers.json`), filepath);
        assertUndefined(obj['x-kixx-new-object']);
        assertEqual('image/jpeg', obj['Content-Type']);
        assertMatches(CONTENT_LEN_PATTERN, obj['Content-Length']);
        assertMatches(MD5_PATTERN, obj['ETag']);
        assertMatches(HTTP_DATE_PATTERN, obj['Last-Modified']);
    });

    it('returns the new headers', () => {
        assertEqual('1', returnValue.get('x-kixx-new-object'));
        assertEqual('image/jpeg', returnValue.get('content-type'));
        assertMatches(CONTENT_LEN_PATTERN, returnValue.get('content-length'));
        assertMatches(MD5_PATTERN, returnValue.get('etag'));
        assertMatches(HTTP_DATE_PATTERN, returnValue.get('last-modified'));
    });
});
