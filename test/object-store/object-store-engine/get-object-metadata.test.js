import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStoreEngine from '../../../lib/object-store/object-store-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('ObjectStoreEngine:getObjectMetadata', ({ before, it }) => {

    const referenceId = 'some-image.jpg';
    const metadata = {};

    const fileSystem = {
        readJSONFile: sinon.fake.resolves(metadata),
    };

    let returnValue;

    before(async () => {
        const engine = new ObjectStoreEngine({
            logger: new Logger(),
            fileSystem,
            directory: thisDirectory,
        });

        returnValue = await engine.getObjectMetadata(referenceId);
    });

    it('reads the JSON file', () => {
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(thisDirectory, `meta__${ referenceId }.json`), fileSystem.readJSONFile.firstCall.args[0]);
    });

    it('returns the result of the JSON file', () => {
        assertEqual(metadata, returnValue);
    });
});

class Logger {
    debug() {}
    info() {}
    warn() {}
    error() {}
}
