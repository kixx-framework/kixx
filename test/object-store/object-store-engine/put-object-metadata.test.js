import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStoreEngine from '../../../object-store/object-store-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('ObjectStoreEngine:putObjectMetadata', ({ before, it }) => {

    const objectId = 'an-object-123';
    const referenceId = 'some-image.jpg';
    const document = {};

    const fileSystem = {
        writeJSONFile: sinon.fake.resolves(),
    };

    before(async () => {
        const engine = new ObjectStoreEngine({
            logger: new Logger(),
            fileSystem,
            directory: thisDirectory,
        });

        await engine.putObjectMetadata(objectId, referenceId, document);
    });

    it('writes the JSON file', () => {
        assertEqual(1, fileSystem.writeJSONFile.callCount);
        assertEqual(path.join(thisDirectory, `meta__${ referenceId }.json`), fileSystem.writeJSONFile.firstCall.args[0]);
        const newDocument = fileSystem.writeJSONFile.firstCall.args[1];
        assertEqual(objectId, newDocument.objectId);
    });
});

class Logger {
    debug() {}
    info() {}
    warn() {}
    error() {}
}
