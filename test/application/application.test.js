import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual
} from 'kixx-assert';
import Application from '../../lib/application/application.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CWD = path.join(THIS_DIR, 'fake-cwd');
const FAKE_APP_DIR = path.join(THIS_DIR, 'fake-app');


describe('Application#constructor with valid currentWorkingDirectory', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('sets the currentWorkingDirectory', () => {
        assertEqual(FAKE_CWD, app.currentWorkingDirectory);
    });

    it('has null applicationDirectory by default', () => {
        assertEqual(null, app.applicationDirectory);
    });

    it('has null configFilepath by default', () => {
        assertEqual(null, app.configFilepath);
    });

    it('has null context by default', () => {
        assertEqual(null, app.context);
    });

    it('initializes middleware Map', () => {
        assert(app.middleware instanceof Map);
        assertEqual(0, app.middleware.size);
    });

    it('initializes requestHandlers Map', () => {
        assert(app.requestHandlers instanceof Map);
        assertEqual(0, app.requestHandlers.size);
    });

    it('initializes errorHandlers Map', () => {
        assert(app.errorHandlers instanceof Map);
        assertEqual(0, app.errorHandlers.size);
    });
});


describe('Application#constructor with applicationDirectory', ({ it }) => {
    const app = new Application({
        currentWorkingDirectory: FAKE_CWD,
        applicationDirectory: FAKE_APP_DIR,
    });

    it('sets the currentWorkingDirectory', () => {
        assertEqual(FAKE_CWD, app.currentWorkingDirectory);
    });

    it('sets the applicationDirectory', () => {
        assertEqual(FAKE_APP_DIR, app.applicationDirectory);
    });
});


describe('Application#constructor without currentWorkingDirectory', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;

        try {
            new Application({});
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('currentWorkingDirectory'));
    });
});


describe('Application#constructor with empty currentWorkingDirectory', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;

        try {
            new Application({ currentWorkingDirectory: '' });
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('Application#loadConfiguration with all options provided', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'kixx-config.jsonc');
    const secretsFilepath = path.join(FAKE_APP_DIR, '.secrets.jsonc');

    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {
                logger: { level: 'debug', mode: 'console' },
            },
        },
    };

    const secretsData = {
        environments: {
            development: {
                JSONWebToken: { KEY: 'test-key' },
            },
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub(),
        readDirectory: sinon.stub(),
    };

    let app;
    let config;

    before(async () => {
        fileSystem.readJSONFile.withArgs(configFilepath).resolves(configData);
        fileSystem.readJSONFile.withArgs(secretsFilepath).resolves(secretsData);

        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        config = await app.loadConfiguration({
            environment: 'development',
            configFilepath,
            secretsFilepath,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('reads config file from specified path', () => {
        assertEqual(configFilepath, fileSystem.readJSONFile.firstCall.firstArg);
    });

    it('reads secrets file from specified path', () => {
        assertEqual(secretsFilepath, fileSystem.readJSONFile.secondCall.firstArg);
    });

    it('does not call readDirectory when paths are provided', () => {
        assertEqual(0, fileSystem.readDirectory.callCount);
    });

    it('returns a config instance', () => {
        assert(config);
        assertEqual('Test App', config.name);
        assertEqual('testapp', config.processName);
    });

    it('sets the applicationDirectory from config file location', () => {
        assertEqual(FAKE_APP_DIR, app.applicationDirectory);
    });

    it('sets the configFilepath from the provided option', () => {
        assertEqual(configFilepath, app.configFilepath);
    });
});


describe('Application#loadConfiguration with only environment option', ({ before, after, it }) => {
    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {
                logger: { level: 'debug', mode: 'console' },
            },
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(configData),
        readDirectory: sinon.stub().resolves([
            { name: 'kixx-config.jsonc', isFile: () => true, isDirectory: () => false },
        ]),
    };

    let app;
    let config;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        config = await app.loadConfiguration({
            environment: 'development',
        });
    });

    after(() => {
        sinon.restore();
    });

    it('reads the application directory to discover config and secrets', () => {
        // Called twice: once for config discovery, once for secrets discovery
        assertEqual(2, fileSystem.readDirectory.callCount);
        assertEqual(FAKE_CWD, fileSystem.readDirectory.firstCall.firstArg);
        assertEqual(FAKE_CWD, fileSystem.readDirectory.secondCall.firstArg);
    });

    it('returns a config instance', () => {
        assert(config);
        assertEqual('Test App', config.name);
    });

    it('sets applicationDirectory to currentWorkingDirectory', () => {
        assertEqual(FAKE_CWD, app.applicationDirectory);
    });

    it('sets configFilepath to the discovered config file', () => {
        assertEqual(path.join(FAKE_CWD, 'kixx-config.jsonc'), app.configFilepath);
    });
});


describe('Application#loadConfiguration caches values for subsequent calls', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'kixx-config.jsonc');
    const secretsFilepath = path.join(FAKE_APP_DIR, '.secrets.jsonc');

    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {},
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(configData),
        readDirectory: sinon.stub(),
    };

    let app;
    let firstConfig;
    let secondConfig;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        // First call with all options
        firstConfig = await app.loadConfiguration({
            environment: 'development',
            configFilepath,
            secretsFilepath,
        });

        // Second call without options - should use cached values
        secondConfig = await app.loadConfiguration();
    });

    after(() => {
        sinon.restore();
    });

    it('reads config file twice (once per loadConfiguration call)', () => {
        assertEqual(4, fileSystem.readJSONFile.callCount);
    });

    it('uses cached configFilepath on second call', () => {
        assertEqual(configFilepath, fileSystem.readJSONFile.getCall(2).firstArg);
    });

    it('uses cached secretsFilepath on second call', () => {
        assertEqual(secretsFilepath, fileSystem.readJSONFile.getCall(3).firstArg);
    });

    it('returns the same config instance on second call', () => {
        assertEqual(firstConfig, secondConfig);
    });
});


describe('Application#loadConfiguration without environment throws', ({ before, after, it }) => {
    const fileSystem = {
        readJSONFile: sinon.stub(),
        readDirectory: sinon.stub(),
    };

    let error;

    before(async () => {
        const app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        try {
            await app.loadConfiguration({});
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws an AssertionError', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('includes environment in error message', () => {
        assert(error.message.includes('environment'));
    });
});


describe('Application#loadConfiguration when config file not found', ({ before, after, it }) => {
    const fileSystem = {
        readJSONFile: sinon.stub().resolves(null),
        readDirectory: sinon.stub().resolves([
            { name: 'other-file.txt', isFile: () => true, isDirectory: () => false },
        ]),
    };

    let error;

    before(async () => {
        const app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        try {
            await app.loadConfiguration({ environment: 'development' });
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws a NotFoundError', () => {
        assert(error);
        // WrappedError with name override to NotFoundError
        assertEqual('NotFoundError', error.name);
    });

    it('has ENOENT code', () => {
        assertEqual('ENOENT', error.code);
    });

    it('includes directory path in message', () => {
        assert(error.message.includes(FAKE_CWD));
    });
});


describe('Application#loadConfiguration when specified config file does not exist', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'missing-config.jsonc');

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(null),
        readDirectory: sinon.stub(),
    };

    let error;

    before(async () => {
        const app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        try {
            await app.loadConfiguration({
                environment: 'development',
                configFilepath,
            });
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws a WrappedError', () => {
        assert(error);
        assertEqual('WrappedError', error.name);
    });

    it('includes filepath in message', () => {
        assert(error.message.includes(configFilepath));
    });
});


describe('Application#registerMiddleware with valid arguments', ({ before, it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });
    const middlewareFn = () => {};

    before(() => {
        app.registerMiddleware('testMiddleware', middlewareFn);
    });

    it('adds middleware to the map', () => {
        assertEqual(1, app.middleware.size);
    });

    it('stores middleware by name', () => {
        assertEqual(middlewareFn, app.middleware.get('testMiddleware'));
    });
});


describe('Application#registerMiddleware without name', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerMiddleware(null, () => {});
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('name'));
    });
});


describe('Application#registerMiddleware with empty name', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerMiddleware('', () => {});
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('Application#registerMiddleware without function', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerMiddleware('testMiddleware', 'not a function');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('function'));
    });
});


describe('Application#registerRequestHandler with valid arguments', ({ before, it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });
    const handlerFn = () => {};

    before(() => {
        app.registerRequestHandler('testHandler', handlerFn);
    });

    it('adds handler to the map', () => {
        assertEqual(1, app.requestHandlers.size);
    });

    it('stores handler by name', () => {
        assertEqual(handlerFn, app.requestHandlers.get('testHandler'));
    });
});


describe('Application#registerRequestHandler without name', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerRequestHandler(null, () => {});
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('name'));
    });
});


describe('Application#registerRequestHandler without function', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerRequestHandler('testHandler', { notA: 'function' });
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('function'));
    });
});


describe('Application#registerErrorHandler with valid arguments', ({ before, it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });
    const handlerFn = () => {};

    before(() => {
        app.registerErrorHandler('testErrorHandler', handlerFn);
    });

    it('adds handler to the errorHandlers map', () => {
        assertEqual(1, app.errorHandlers.size);
    });

    it('stores handler by name', () => {
        assertEqual(handlerFn, app.errorHandlers.get('testErrorHandler'));
    });
});


describe('Application#registerErrorHandler without name', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerErrorHandler(undefined, () => {});
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('name'));
    });
});


describe('Application#registerErrorHandler without function', ({ it }) => {
    const app = new Application({ currentWorkingDirectory: FAKE_CWD });

    it('throws an AssertionError', () => {
        let error;

        try {
            app.registerErrorHandler('testErrorHandler', null);
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('function'));
    });
});


describe('Application#createLogger with config parameter', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'kixx-config.jsonc');
    const secretsFilepath = path.join(FAKE_APP_DIR, '.secrets.jsonc');

    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {
                logger: { level: 'info', mode: 'stdout' },
            },
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(configData),
        readDirectory: sinon.stub(),
    };

    let app;
    let config;
    let logger;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        config = await app.loadConfiguration({
            environment: 'development',
            configFilepath,
            secretsFilepath,
        });

        logger = app.createLogger(config);
    });

    after(() => {
        sinon.restore();
    });

    it('returns a logger instance', () => {
        assert(logger);
    });

    it('sets logger level from config', () => {
        assertEqual('INFO', logger.level);
    });

    it('sets logger mode from config', () => {
        assertEqual('stdout', logger.mode);
    });
});


describe('Application#createLogger uses cached config', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'kixx-config.jsonc');
    const secretsFilepath = path.join(FAKE_APP_DIR, '.secrets.jsonc');

    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {
                logger: { level: 'warn', mode: 'console' },
            },
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(configData),
        readDirectory: sinon.stub(),
    };

    let app;
    let logger;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        // Load configuration first to cache it
        await app.loadConfiguration({
            environment: 'development',
            configFilepath,
            secretsFilepath,
        });

        // Call createLogger without passing config - should use cached
        logger = app.createLogger();
    });

    after(() => {
        sinon.restore();
    });

    it('returns a logger instance', () => {
        assert(logger);
    });

    it('uses cached config for logger level', () => {
        assertEqual('WARN', logger.level);
    });

    it('uses cached config for logger mode', () => {
        assertEqual('console', logger.mode);
    });
});


describe('Application#createLogger with default values', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'kixx-config.jsonc');
    const secretsFilepath = path.join(FAKE_APP_DIR, '.secrets.jsonc');

    // Config without logger settings
    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {},
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(configData),
        readDirectory: sinon.stub(),
    };

    let app;
    let logger;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        await app.loadConfiguration({
            environment: 'development',
            configFilepath,
            secretsFilepath,
        });

        logger = app.createLogger();
    });

    after(() => {
        sinon.restore();
    });

    it('defaults logger level to debug', () => {
        assertEqual('DEBUG', logger.level);
    });

    it('defaults logger mode to console', () => {
        assertEqual('console', logger.mode);
    });
});


describe('Application#createLogger subscribes to config changes', ({ before, after, it }) => {
    const configFilepath = path.join(FAKE_APP_DIR, 'kixx-config.jsonc');
    const secretsFilepath = path.join(FAKE_APP_DIR, '.secrets.jsonc');

    const configData = {
        name: 'Test App',
        processName: 'testapp',
        environments: {
            development: {
                logger: { level: 'debug', mode: 'console' },
            },
        },
    };

    const fileSystem = {
        readJSONFile: sinon.stub().resolves(configData),
        readDirectory: sinon.stub(),
    };

    let app;
    let config;
    let logger;
    let configOnSpy;

    before(async () => {
        app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        config = await app.loadConfiguration({
            environment: 'development',
            configFilepath,
            secretsFilepath,
        });

        // Spy on config.on to verify the change listener is registered
        configOnSpy = sinon.spy(config, 'on');

        logger = app.createLogger(config);
    });

    after(() => {
        sinon.restore();
    });

    it('returns a logger instance', () => {
        assert(logger);
    });

    it('registers a change listener on config', () => {
        assertEqual(1, configOnSpy.callCount);
        assertEqual('change', configOnSpy.firstCall.firstArg);
    });
});


describe('Application#initialize without environment throws', ({ before, after, it }) => {
    const fileSystem = {
        readJSONFile: sinon.stub(),
        readDirectory: sinon.stub(),
    };

    let error;

    before(async () => {
        const app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        try {
            await app.initialize({
                runtime: { server: { name: 'test' } },
            });
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws an AssertionError', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('includes environment in error message', () => {
        assert(error.message.includes('environment'));
    });
});


describe('Application#initialize with empty environment throws', ({ before, after, it }) => {
    const fileSystem = {
        readJSONFile: sinon.stub(),
        readDirectory: sinon.stub(),
    };

    let error;

    before(async () => {
        const app = new Application({
            currentWorkingDirectory: FAKE_CWD,
            fileSystem,
        });

        try {
            await app.initialize({
                runtime: { server: { name: 'test' } },
                environment: '',
            });
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws an AssertionError', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
    });
});
