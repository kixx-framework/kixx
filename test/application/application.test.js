import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import Application from '../../lib/application/application.js';

import { assertEqual } from 'kixx-assert';

// Mock current working directory
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

describe('Application#loadLatestSecrets() with explicit filepath', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;
    const filepath = path.join('var', 'my-server', '.secrets.jsonc');
    const json = {};

    const readDirectory = sinon.stub();
    const readJSONFile = sinon.stub().resolves(json);

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: originalAppDir,
            applicationDirectory: originalAppDir,
            fileSystem,
        });

        result = await app.loadLatestSecrets(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('returns the results of reading the JSON file', () => {
        assertEqual(json, result);
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(filepath, fileSystem.readJSONFile.getCall(0).args[0]);
    });

    it('does not set the application directory', () => {
        assertEqual(originalAppDir, app.applicationDirectory);
    });

    it('does not read the application directory', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });
});
