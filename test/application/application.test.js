import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import Application from '../../lib/application/application.js';

import { isPlainObject, assert, assertEqual } from 'kixx-assert';

// Mock current working directory
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));


describe('Application#initialize() with explicit config filepaths in app directory', ({ before, after, it }) => {

    const configFilepath = path.join(DIRECTORY, 'my', 'application', 'kixx-config.json');
    const secretsFilepath = path.join(DIRECTORY, 'my', 'application', '.secrets.json');

    const readJSONFile = sinon.stub().resolves({ production: {}, development: {}, test: {} });

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem: { readJSONFile },
        });

        // We don't want to actually call these methods.
        sinon.stub(app, 'createLogger');
        sinon.stub(app, 'createAndInitializeViewService');
        sinon.stub(app, 'createAndLoadDatastore');
        sinon.stub(app, 'initializePlugins');

        result = await app.initialize({
            runtime: {},
            environment: 'test',
            configFilepath,
            secretsFilepath,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('returns the context', () => {
        assertEqual('Context', result.constructor.name);
    });

    it('sets the application directory', () => {
        const appDirectory = path.dirname(configFilepath);
        assertEqual(appDirectory, app.applicationDirectory);
        assertEqual(appDirectory, result.paths.app_directory);
    });

    it('calls readJSONFile() with expected filepaths', () => {
        assertEqual(2, readJSONFile.callCount);
        assertEqual(configFilepath, readJSONFile.getCall(0).args[0]);
        assertEqual(secretsFilepath, readJSONFile.getCall(1).args[0]);
    });
});

describe('Application#initialize() with explicit config filepaths outside app directory', ({ before, after, it }) => {
    const configDirectory = path.dirname(DIRECTORY);
    const appDirectory = path.join(DIRECTORY, 'application');

    const configFilepath = path.join(configDirectory, 'kixx-config.json');
    const secretsFilepath = path.join(configDirectory, '.secrets.json');

    const readJSONFile = sinon.stub().resolves({ production: {}, development: {}, test: {} });

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            applicationDirectory: appDirectory,
            fileSystem: { readJSONFile },
        });

        // We don't want to actually call these methods.
        sinon.stub(app, 'createLogger');
        sinon.stub(app, 'createAndInitializeViewService');
        sinon.stub(app, 'createAndLoadDatastore');
        sinon.stub(app, 'initializePlugins');

        result = await app.initialize({
            runtime: {},
            environment: 'test',
            configFilepath,
            secretsFilepath,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('returns the context', () => {
        assertEqual('Context', result.constructor.name);
    });

    it('sets the application directory to the current working directory', () => {
        assertEqual(appDirectory, app.applicationDirectory);
        assertEqual(appDirectory, result.paths.app_directory);
    });

    it('calls readJSONFile() with expected filepaths', () => {
        assertEqual(2, readJSONFile.callCount);
        assertEqual(configFilepath, readJSONFile.getCall(0).args[0]);
        assertEqual(secretsFilepath, readJSONFile.getCall(1).args[0]);
    });
});

describe('Application#initialize() with explicit applicationDirectory', ({ before, after, it }) => {
    const appDirectory = path.join(DIRECTORY, 'application');
    const configFilepath = path.join(appDirectory, 'kixx-config.json');
    const secretsFilepath = path.join(appDirectory, '.secrets.json');

    const readDirectory = sinon.stub().resolves([
        {
            name: 'kixx-config.json',
            isFile() {
                return true;
            },
        },
        {
            name: '.secrets.json',
            isFile() {
                return true;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves({ production: {}, development: {}, test: {} });

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            applicationDirectory: appDirectory,
            fileSystem: { readDirectory, readJSONFile },
        });

        // We don't want to actually call these methods.
        sinon.stub(app, 'createLogger');
        sinon.stub(app, 'createAndInitializeViewService');
        sinon.stub(app, 'createAndLoadDatastore');
        sinon.stub(app, 'initializePlugins');

        result = await app.initialize({
            runtime: {},
            environment: 'test',
        });
    });

    after(() => {
        sinon.restore();
    });

    it('returns the context', () => {
        assertEqual('Context', result.constructor.name);
    });

    it('sets the application directory', () => {
        assertEqual(appDirectory, app.applicationDirectory);
        assertEqual(appDirectory, result.paths.app_directory);
    });

    it('calls readDirectory() with the application directory', () => {
        assertEqual(2, readDirectory.callCount);
        assertEqual(appDirectory, readDirectory.getCall(0).args[0]);
        assertEqual(appDirectory, readDirectory.getCall(1).args[0]);
    });

    it('calls readJSONFile() with expected filepaths', () => {
        assertEqual(2, readJSONFile.callCount);
        assertEqual(configFilepath, readJSONFile.getCall(0).args[0]);
        assertEqual(secretsFilepath, readJSONFile.getCall(1).args[0]);
    });
});

describe('Application#initialize() with only currentWorkingDirectory', ({ before, after, it }) => {
    const configFilepath = path.join(DIRECTORY, 'kixx-config.json');
    const secretsFilepath = path.join(DIRECTORY, '.secrets.json');

    const readDirectory = sinon.stub().resolves([
        {
            name: 'kixx-config.json',
            isFile() {
                return true;
            },
        },
        {
            name: '.secrets.json',
            isFile() {
                return true;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves({ production: {}, development: {}, test: {} });

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem: { readDirectory, readJSONFile },
        });

        // We don't want to actually call these methods.
        sinon.stub(app, 'createLogger');
        sinon.stub(app, 'createAndInitializeViewService');
        sinon.stub(app, 'createAndLoadDatastore');
        sinon.stub(app, 'initializePlugins');

        result = await app.initialize({
            runtime: {},
            environment: 'test',
        });
    });

    after(() => {
        sinon.restore();
    });

    it('returns the context', () => {
        assertEqual('Context', result.constructor.name);
    });

    it('sets the application directory to the current working directory', () => {
        assertEqual(DIRECTORY, app.applicationDirectory);
        assertEqual(DIRECTORY, result.paths.app_directory);
    });

    it('calls readDirectory() with the application directory', () => {
        assertEqual(2, readDirectory.callCount);
        assertEqual(DIRECTORY, readDirectory.getCall(0).args[0]);
        assertEqual(DIRECTORY, readDirectory.getCall(1).args[0]);
    });

    it('calls readJSONFile() with expected filepaths', () => {
        assertEqual(2, readJSONFile.callCount);
        assertEqual(configFilepath, readJSONFile.getCall(0).args[0]);
        assertEqual(secretsFilepath, readJSONFile.getCall(1).args[0]);
    });
});

describe('Application#createRootUser()', ({ before, after, it }) => {

    const rootUser = { id: 1, username: 'root' };

    const collection = {
        createRootUser: sinon.stub().returns(rootUser),
    };

    const context = {
        getCollection: sinon.stub().returns(collection),
    };

    const fileSystem = {};

    let app;
    let result;

    before(() => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem,
        });

        result = app.createRootUser(context);
    });

    after(() => {
        sinon.restore();
    });

    it('calls getCollection with the collectionType', () => {
        assertEqual(1, context.getCollection.callCount);
        assertEqual('app.User', context.getCollection.getCall(0).args[0]);
    });

    it('calls createRootUser on the collection', () => {
        assertEqual(1, collection.createRootUser.callCount);
    });

    it('returns the result from collection.createRootUser', () => {
        assertEqual(rootUser, result);
    });
});

describe('Application#createRootUser() with custom collectionType', ({ before, after, it }) => {

    const rootUser = { id: 1, username: 'admin' };

    const collection = {
        createRootUser: sinon.stub().returns(rootUser),
    };

    const context = {
        getCollection: sinon.stub().returns(collection),
    };

    const fileSystem = {};

    let app;
    let result;

    before(() => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem,
        });

        result = app.createRootUser(context, 'custom.AdminUser');
    });

    after(() => {
        sinon.restore();
    });

    it('calls getCollection with the custom collectionType', () => {
        assertEqual(1, context.getCollection.callCount);
        assertEqual('custom.AdminUser', context.getCollection.getCall(0).args[0]);
    });

    it('calls createRootUser on the collection', () => {
        assertEqual(1, collection.createRootUser.callCount);
    });

    it('returns the result from collection.createRootUser', () => {
        assertEqual(rootUser, result);
    });
});

describe('Application#createRootUser() when context is null', ({ before, it }) => {

    const fileSystem = {};

    let app;
    let result;

    before(() => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem,
        });

        try {
            app.createRootUser();
        } catch (err) {
            result = err;
        }
    });

    it('throws an AssertionError', () => {
        assertEqual('AssertionError', result.name);
    });
});

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

describe('Application#loadLatestSecrets() with explicit filepath and unset applicationDirectory', ({ before, after, it }) => {

    const filepath = path.join(DIRECTORY, 'my-server', '.secrets.jsonc');
    const json = {};

    const readDirectory = sinon.stub();
    const readJSONFile = sinon.stub().resolves(json);

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
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

    it('sets the application directory', () => {
        assertEqual(path.dirname(filepath), app.applicationDirectory);
    });

    it('does not read the application directory', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });
});

describe('Application#loadLatestSecrets() with explicit filepath and empty JSON file', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;
    const filepath = path.join('var', 'my-server', '.secrets.jsonc');

    const readDirectory = sinon.stub();
    const readJSONFile = sinon.stub().resolves(null);

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

    it('returns an empty object', () => {
        assert(isPlainObject(result));
    });

    it('does not set the application directory', () => {
        assertEqual(originalAppDir, app.applicationDirectory);
    });

    it('does not read the application directory', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });
});

describe('Application#loadLatestSecrets()', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;
    const json = {};

    const readDirectory = sinon.stub().resolves([
        {
            name: '.secrets.js',
            isFile() {
                return true;
            },
        },
        {
            name: '.secrets.jsonc',
            isFile() {
                return true;
            },
        },
        {
            name: 'lib',
            isFile() {
                return false;
            },
        },
        {
            name: 'vendor',
            isFile() {
                return false;
            },
        },
    ]);

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

        result = await app.loadLatestSecrets();
    });

    after(() => {
        sinon.restore();
    });

    it('returns the results of reading the JSON file', () => {
        assertEqual(json, result);
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(originalAppDir, '.secrets.jsonc'), fileSystem.readJSONFile.getCall(0).args[0]);
    });

    it('does not set the application directory', () => {
        assertEqual(originalAppDir, app.applicationDirectory);
    });

    it('reads the application directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(originalAppDir, fileSystem.readDirectory.getCall(0).args[0]);
    });
});

describe('Application#loadLatestSecrets() when applicationDirectory is not set', ({ before, after, it }) => {

    const json = {};

    const readDirectory = sinon.stub().resolves([
        {
            name: '.secrets.js',
            isFile() {
                return true;
            },
        },
        {
            name: '.secrets.jsonc',
            isFile() {
                return true;
            },
        },
        {
            name: 'lib',
            isFile() {
                return false;
            },
        },
        {
            name: 'vendor',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(json);

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem,
        });

        result = await app.loadLatestSecrets();
    });

    after(() => {
        sinon.restore();
    });

    it('returns the results of reading the JSON file', () => {
        assertEqual(json, result);
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(DIRECTORY, '.secrets.jsonc'), fileSystem.readJSONFile.getCall(0).args[0]);
    });

    it('sets the application directory', () => {
        assertEqual(DIRECTORY, app.applicationDirectory);
    });

    it('reads the application directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(DIRECTORY, fileSystem.readDirectory.getCall(0).args[0]);
    });
});

describe('Application#loadLatestSecrets() when secrets file not found', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;

    const readDirectory = sinon.stub().resolves([
        {
            name: '.secrets.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'lib',
            isFile() {
                return false;
            },
        },
        {
            name: 'vendor',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub();

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: originalAppDir,
            applicationDirectory: originalAppDir,
            fileSystem,
        });

        result = await app.loadLatestSecrets();
    });

    after(() => {
        sinon.restore();
    });

    it('returns an empty object', () => {
        assert(isPlainObject(result));
    });

    it('does not attempt to read the file', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('reads the application directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(originalAppDir, fileSystem.readDirectory.getCall(0).args[0]);
    });
});

describe('Application#loadLatestConfig() with explicit filepath', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;
    const filepath = path.join('var', 'my-server', 'kixx-config.jsonc');
    const json = { port: 3000 };

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

        result = await app.loadLatestConfig(filepath);
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

describe('Application#loadLatestConfig() with explicit filepath and unset applicationDirectory', ({ before, after, it }) => {

    const filepath = path.join(DIRECTORY, 'my-server', 'kixx-config.jsonc');
    const json = { port: 3000 };

    const readDirectory = sinon.stub();
    const readJSONFile = sinon.stub().resolves(json);

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem,
        });

        result = await app.loadLatestConfig(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('returns the results of reading the JSON file', () => {
        assertEqual(json, result);
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(filepath, fileSystem.readJSONFile.getCall(0).args[0]);
    });

    it('sets the application directory', () => {
        assertEqual(path.dirname(filepath), app.applicationDirectory);
    });

    it('does not read the application directory', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });
});

describe('Application#loadLatestConfig() with explicit filepath and empty JSON file', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;
    const filepath = path.join('var', 'my-server', 'kixx-config.jsonc');

    const readDirectory = sinon.stub();
    const readJSONFile = sinon.stub().resolves(null);

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: originalAppDir,
            applicationDirectory: originalAppDir,
            fileSystem,
        });

        try {
            await app.loadLatestConfig(filepath);
        } catch (err) {
            result = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws a WrappedError', () => {
        assertEqual('WrappedError', result.name);
    });

    it('does not set the application directory', () => {
        assertEqual(originalAppDir, app.applicationDirectory);
    });

    it('does not read the application directory', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });
});

describe('Application#loadLatestConfig()', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;
    const json = { port: 3000 };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'kixx-config.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'kixx-config.jsonc',
            isFile() {
                return true;
            },
        },
        {
            name: 'lib',
            isFile() {
                return false;
            },
        },
        {
            name: 'vendor',
            isFile() {
                return false;
            },
        },
    ]);

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

        result = await app.loadLatestConfig();
    });

    after(() => {
        sinon.restore();
    });

    it('returns the results of reading the JSON file', () => {
        assertEqual(json, result);
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(originalAppDir, 'kixx-config.jsonc'), fileSystem.readJSONFile.getCall(0).args[0]);
    });

    it('does not set the application directory', () => {
        assertEqual(originalAppDir, app.applicationDirectory);
    });

    it('reads the application directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(originalAppDir, fileSystem.readDirectory.getCall(0).args[0]);
    });
});

describe('Application#loadLatestConfig() when applicationDirectory is not set', ({ before, after, it }) => {

    const json = { port: 3000 };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'kixx-config.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'kixx-config.jsonc',
            isFile() {
                return true;
            },
        },
        {
            name: 'lib',
            isFile() {
                return false;
            },
        },
        {
            name: 'vendor',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(json);

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: DIRECTORY,
            fileSystem,
        });

        result = await app.loadLatestConfig();
    });

    after(() => {
        sinon.restore();
    });

    it('returns the results of reading the JSON file', () => {
        assertEqual(json, result);
        assertEqual(1, fileSystem.readJSONFile.callCount);
        assertEqual(path.join(DIRECTORY, 'kixx-config.jsonc'), fileSystem.readJSONFile.getCall(0).args[0]);
    });

    it('sets the application directory', () => {
        assertEqual(DIRECTORY, app.applicationDirectory);
    });

    it('reads the application directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(DIRECTORY, fileSystem.readDirectory.getCall(0).args[0]);
    });
});

describe('Application#loadLatestConfig() when config file not found', ({ before, after, it }) => {

    const originalAppDir = DIRECTORY;

    const readDirectory = sinon.stub().resolves([
        {
            name: 'kixx-config.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'lib',
            isFile() {
                return false;
            },
        },
        {
            name: 'vendor',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub();

    const fileSystem = { readDirectory, readJSONFile };

    let app;
    let result;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: originalAppDir,
            applicationDirectory: originalAppDir,
            fileSystem,
        });

        try {
            await app.loadLatestConfig();
        } catch (err) {
            result = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws a NotFoundError', () => {
        assertEqual('NotFoundError', result.name);
        assertEqual('ENOENT', result.code);
    });

    it('does not attempt to read the file', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('reads the application directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(originalAppDir, fileSystem.readDirectory.getCall(0).args[0]);
    });
});
