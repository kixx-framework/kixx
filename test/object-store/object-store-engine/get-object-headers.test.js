import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStoreEngine from '../../../object-store/object-store-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('ObjectStoreEngine:getObjectHeaders', ({ before, it }) => {

    const objectId = 'an-object-123';

    const headers = {
        'Content-Type': 'image/jpeg',
        'Content-Length': '45',
        'Etag': '123',
        'Last-Modified': new Date().toUTCString(),
    };

    const fileSystem = {
        readJSONFile: sinon.fake.resolves(headers),
    };

    let returnValue;

    before(async () => {
        const engine = new ObjectStoreEngine({
            logger: new Logger(),
            fileSystem,
            directory: thisDirectory,
        });

        returnValue = await engine.getObjectHeaders(objectId);
    });

    it('reads the JSON file', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(thisDirectory, `${ objectId }__headers.json`), fileSystem.readJSONFile.firstCall.args[0]);
    });

    it('returns the result of the JSON file', () => {
        assertEqual('image/jpeg', returnValue.get('Content-Type'));
        assertEqual('45', returnValue.get('Content-Length'));
        assertEqual('123', returnValue.get('etag'));
        assertEqual(headers['Last-Modified'], returnValue.get('last-modified'));
    });
});

class Logger {
    debug() {}
    info() {}
    warn() {}
    error() {}
}
