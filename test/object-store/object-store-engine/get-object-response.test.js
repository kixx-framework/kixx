import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStoreEngine from '../../../lib/object-store/object-store-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


class Logger {
    debug() {}
    info() {}
    warn() {}
    error() {}
}


describe('ObjectStoreEngine:getObjectResponse object file not found', ({ before, after, it }) => {
    let sandbox;

    const objectId = 'an-object-123';

    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
        'ETag': '123',
        'Last-Modified': new Date().toUTCString(),
    };

    let error;

    const fileSystem = {
        readJSONFile: sinon.fake.resolves(headers),
        createReadStream: sinon.fake.returns(null),
    };

    const logger = new Logger();

    before(async () => {
        sandbox = sinon.createSandbox();

        sandbox.replace(logger, 'warn', sinon.fake.returns());

        const engine = new ObjectStoreEngine({
            logger,
            fileSystem,
            directory: thisDirectory,
        });

        try {
            await engine.getObjectResponse(objectId);
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('reads the headers file', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(thisDirectory, `${ objectId }__headers.json`), fileSystem.readJSONFile.firstCall.args[0]);
    });

    it('logs a warning', () => {
        assertEqual(1, logger.warn.callCount);
        assertEqual('expected object file not found', logger.warn.firstCall.args[0]);
    });

    it('throws an error', () => {
        assertEqual('AssertionError', error.name);
    });
});

describe('ObjectStoreEngine:getObjectResponse missing headers', ({ before, after, it }) => {
    let sandbox;

    const objectId = 'an-object-123';

    const readStream = {};

    let returnValue;

    const fileSystem = {
        readJSONFile: sinon.fake.resolves(null),
        createReadStream: sinon.fake.returns(readStream),
    };

    const logger = new Logger();

    before(async () => {
        sandbox = sinon.createSandbox();

        sandbox.replace(logger, 'debug', sinon.fake.returns());

        const engine = new ObjectStoreEngine({
            logger,
            fileSystem,
            directory: thisDirectory,
        });

        returnValue = await engine.getObjectResponse(objectId);
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('reads the headers file', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(thisDirectory, `${ objectId }__headers.json`), fileSystem.readJSONFile.firstCall.args[0]);
    });

    it('does not call createReadStream', () => {
        assertEqual(0, fileSystem.createReadStream.callCount);
    });

    it('logs a warning', () => {
        assertEqual(1, logger.debug.callCount);
        assertEqual('headers file not found', logger.debug.firstCall.args[0]);
    });

    it('returns null', () => {
        assertEqual(null, returnValue);
    });
});

describe('ObjectStoreEngine:getObjectResponse', ({ before, it }) => {

    const objectId = 'an-object-123';

    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
        'ETag': '123',
        'Last-Modified': new Date().toUTCString(),
    };

    const readStream = {};

    let returnValue;

    const fileSystem = {
        readJSONFile: sinon.fake.resolves(headers),
        createReadStream: sinon.fake.returns(readStream),
    };

    before(async () => {
        const engine = new ObjectStoreEngine({
            logger: new Logger(),
            fileSystem,
            directory: thisDirectory,
        });

        returnValue = await engine.getObjectResponse(objectId);
    });

    it('reads the headers file', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(thisDirectory, `${ objectId }__headers.json`), fileSystem.readJSONFile.firstCall.args[0]);
    });

    it('creates a read stream for the object', () => {
        assertEqual(1, fileSystem.createReadStream.callCount);
        assertEqual(path.join(thisDirectory, objectId), fileSystem.createReadStream.firstCall.args[0]);
        const opts = fileSystem.createReadStream.firstCall.args[1];
        assertEqual(null, opts.encoding);
    });

    it('returns the stream with headers', () => {
        assertEqual(readStream, returnValue);
        assertEqual('image/jpeg', returnValue.headers.get('content-type'));
        assertEqual('45', returnValue.headers.get('content-length'));
        assertEqual('123', returnValue.headers.get('etag'));
        assertEqual(headers['Last-Modified'], returnValue.headers.get('last-modified'));
    });
});
