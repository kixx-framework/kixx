import path from 'node:path';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import Plugin from '../../lib/application/plugin.js';


describe('Plugin#constructor', ({ it }) => {
    const fileSystem = {};
    const directory = '/path/to/my-plugin';
    const plugin = new Plugin(fileSystem, directory);

    it('sets the name from the directory basename', () => {
        assertEqual('my-plugin', plugin.name);
    });

    it('sets the directory', () => {
        assertEqual(directory, plugin.directory);
    });

    it('sets the collectionsDirectory', () => {
        assertEqual(path.join(directory, 'collections'), plugin.collectionsDirectory);
    });

    it('sets the middlewareDirectory', () => {
        assertEqual(path.join(directory, 'middleware'), plugin.middlewareDirectory);
    });

    it('sets the requestHandlerDirectory', () => {
        assertEqual(path.join(directory, 'request-handlers'), plugin.requestHandlerDirectory);
    });

    it('sets the errorHandlerDirectory', () => {
        assertEqual(path.join(directory, 'error-handlers'), plugin.errorHandlerDirectory);
    });

    it('initializes filepath to null', () => {
        assertEqual(null, plugin.filepath);
    });

    it('initializes register to null', () => {
        assertEqual(null, plugin.register);
    });

    it('initializes initialize to null', () => {
        assertEqual(null, plugin.initialize);
    });

    it('initializes collections as empty Map', () => {
        assert(plugin.collections instanceof Map);
        assertEqual(0, plugin.collections.size);
    });

    it('initializes middleware as empty Map', () => {
        assert(plugin.middleware instanceof Map);
        assertEqual(0, plugin.middleware.size);
    });

    it('initializes requestHandlers as empty Map', () => {
        assert(plugin.requestHandlers instanceof Map);
        assertEqual(0, plugin.requestHandlers.size);
    });

    it('initializes errorHandlers as empty Map', () => {
        assert(plugin.errorHandlers instanceof Map);
        assertEqual(0, plugin.errorHandlers.size);
    });
});


describe('Plugin#getModuleFilepath when plugin.js exists', ({ before, after, it }) => {
    const directory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'plugin.js', isFile: () => true },
            { name: 'other.js', isFile: () => true },
        ]),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, directory);
        result = await plugin.getModuleFilepath();
    });

    after(() => {
        sinon.restore();
    });

    it('reads the plugin directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(directory, fileSystem.readDirectory.firstCall.firstArg);
    });

    it('returns the filepath to plugin.js', () => {
        assertEqual(path.join(directory, 'plugin.js'), result);
    });
});


describe('Plugin#getModuleFilepath when app.mjs exists', ({ before, after, it }) => {
    const directory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'app.mjs', isFile: () => true },
        ]),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, directory);
        result = await plugin.getModuleFilepath();
    });

    after(() => {
        sinon.restore();
    });

    it('returns the filepath to app.mjs', () => {
        assertEqual(path.join(directory, 'app.mjs'), result);
    });
});


describe('Plugin#getModuleFilepath when no entry point exists', ({ before, after, it }) => {
    const directory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'other.js', isFile: () => true },
            { name: 'readme.md', isFile: () => true },
        ]),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, directory);
        result = await plugin.getModuleFilepath();
    });

    after(() => {
        sinon.restore();
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('Plugin#getModuleFilepath ignores directories named plugin.js', ({ before, after, it }) => {
    const directory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'plugin.js', isFile: () => false },
        ]),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, directory);
        result = await plugin.getModuleFilepath();
    });

    after(() => {
        sinon.restore();
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('Plugin#loadCollection with valid collection directory', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const collectionDirectory = '/path/to/my-plugin/collections/users';

    class User {}

    class UsersCollection {
        static Model = User;
    }

    const schema = { type: 'object', properties: {} };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'users.collection.js', isFile: () => true },
            { name: 'users.schema.json', isFile: () => true },
        ]),
        readJSONFile: sinon.stub().resolves(schema),
        importAbsoluteFilepath: sinon.stub().resolves({ default: UsersCollection }),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        result = await plugin.loadCollection(collectionDirectory);
    });

    after(() => {
        sinon.restore();
    });

    it('reads the collection directory', () => {
        assertEqual(collectionDirectory, fileSystem.readDirectory.firstCall.firstArg);
    });

    it('reads the schema file', () => {
        const expectedPath = path.join(collectionDirectory, 'users.schema.json');
        assertEqual(expectedPath, fileSystem.readJSONFile.firstCall.firstArg);
    });

    it('imports the collection class file', () => {
        const expectedPath = path.join(collectionDirectory, 'users.collection.js');
        assertEqual(expectedPath, fileSystem.importAbsoluteFilepath.firstCall.firstArg);
    });

    it('returns the collection definition with correct name', () => {
        assertEqual('User', result.name);
    });

    it('returns the collection definition with CollectionConstructor', () => {
        assertEqual(UsersCollection, result.CollectionConstructor);
    });

    it('returns the collection definition with schema', () => {
        assertEqual(schema, result.schema);
    });
});


describe('Plugin#loadCollection without schema file', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const collectionDirectory = '/path/to/my-plugin/collections/users';

    class User {}

    class UsersCollection {
        static Model = User;
    }

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'users.collection.js', isFile: () => true },
        ]),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub().resolves({ default: UsersCollection }),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        result = await plugin.loadCollection(collectionDirectory);
    });

    after(() => {
        sinon.restore();
    });

    it('does not read a schema file', () => {
        assertEqual(0, fileSystem.readJSONFile.callCount);
    });

    it('returns empty object for schema', () => {
        assertEqual(0, Object.keys(result.schema).length);
    });
});


describe('Plugin#loadCollection without class file', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const collectionDirectory = '/path/to/my-plugin/collections/users';

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'users.schema.json', isFile: () => true },
        ]),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub(),
    };

    let error;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        try {
            await plugin.loadCollection(collectionDirectory);
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

    it('includes the directory in the error message', () => {
        assert(error.message.includes(collectionDirectory));
    });
});


describe('Plugin#loadCollection when class has no Model property', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const collectionDirectory = '/path/to/my-plugin/collections/users';

    class UsersCollection {}

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'users.collection.js', isFile: () => true },
        ]),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub().resolves({ default: UsersCollection }),
    };

    let error;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        try {
            await plugin.loadCollection(collectionDirectory);
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

    it('mentions Collection.Model in error message', () => {
        assert(error.message.includes('Collection.Model'));
    });
});



describe('Plugin#loadMiddlewareFunction with named function', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const filepath = '/path/to/my-plugin/middleware/auth.js';

    function authMiddleware() {}

    const fileSystem = {
        importAbsoluteFilepath: sinon.stub().resolves({ default: authMiddleware }),
    };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        result = await plugin.loadMiddlewareFunction(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('imports the module', () => {
        assertEqual(filepath, fileSystem.importAbsoluteFilepath.firstCall.firstArg);
    });

    it('returns the default export function', () => {
        assertEqual(authMiddleware, result);
    });
});


describe('Plugin#loadMiddlewareFunction with anonymous function', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const filepath = '/path/to/my-plugin/middleware/auth.js';

    // Create a truly anonymous function by wrapping in an IIFE
    // Arrow functions assigned to object properties get the property name
    const anonymousFunc = (() => () => {})();

    const fileSystem = {
        importAbsoluteFilepath: sinon.stub().resolves({ default: anonymousFunc }),
    };

    let error;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        try {
            await plugin.loadMiddlewareFunction(filepath);
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

    it('mentions named function in error message', () => {
        assert(error.message.includes('named function'));
    });
});


describe('Plugin#loadMiddlewareFunction with non-function export', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const filepath = '/path/to/my-plugin/middleware/auth.js';

    const fileSystem = {
        importAbsoluteFilepath: sinon.stub().resolves({ default: 'not a function' }),
    };

    let error;

    before(async () => {
        const plugin = new Plugin(fileSystem, pluginDirectory);
        try {
            await plugin.loadMiddlewareFunction(filepath);
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


describe('Plugin#loadMiddlewareDirectory with multiple files', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';
    const middlewareDirectory = '/path/to/my-plugin/middleware';

    function authMiddleware() {}
    function loggingMiddleware() {}

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            { name: 'auth.js', isFile: () => true },
            { name: 'logging.mjs', isFile: () => true },
            { name: 'readme.md', isFile: () => true },
        ]),
        importAbsoluteFilepath: sinon.stub(),
    };

    let result;

    before(async () => {
        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(middlewareDirectory, 'auth.js'))
            .resolves({ default: authMiddleware });
        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(middlewareDirectory, 'logging.mjs'))
            .resolves({ default: loggingMiddleware });

        const plugin = new Plugin(fileSystem, pluginDirectory);
        result = await plugin.loadMiddlewareDirectory(middlewareDirectory);
    });

    after(() => {
        sinon.restore();
    });

    it('returns a Map with two middleware functions', () => {
        assert(result instanceof Map);
        assertEqual(2, result.size);
    });

    it('contains auth middleware keyed by function name', () => {
        assertEqual(authMiddleware, result.get('authMiddleware'));
    });

    it('contains logging middleware keyed by function name', () => {
        assertEqual(loggingMiddleware, result.get('loggingMiddleware'));
    });

    it('ignores non-js files', () => {
        assertEqual(2, fileSystem.importAbsoluteFilepath.callCount);
    });
});


describe('Plugin#load with full plugin structure', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';

    function register() {}
    function initialize() {}

    class User {}
    class UsersCollection {
        static Model = User;
    }

    function authMiddleware() {}
    function pageHandler() {}
    function errorHandler() {}

    const fileSystem = {
        readDirectory: sinon.stub(),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub(),
    };

    let plugin;

    before(async () => {
        // Plugin directory - has plugin.js
        fileSystem.readDirectory
            .withArgs(pluginDirectory)
            .resolves([
                { name: 'plugin.js', isFile: () => true },
            ]);

        // Plugin module exports
        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'plugin.js'))
            .resolves({ register, initialize });

        // Collections directory
        fileSystem.readDirectory
            .withArgs(path.join(pluginDirectory, 'collections'))
            .resolves([
                { name: 'users', isDirectory: () => true },
            ]);

        // Users collection directory
        fileSystem.readDirectory
            .withArgs(path.join(pluginDirectory, 'collections', 'users'))
            .resolves([
                { name: 'users.collection.js', isFile: () => true },
            ]);

        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'collections', 'users', 'users.collection.js'))
            .resolves({ default: UsersCollection });

        // Middleware directory
        fileSystem.readDirectory
            .withArgs(path.join(pluginDirectory, 'middleware'))
            .resolves([
                { name: 'auth.js', isFile: () => true },
            ]);

        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'middleware', 'auth.js'))
            .resolves({ default: authMiddleware });

        // Request handlers directory
        fileSystem.readDirectory
            .withArgs(path.join(pluginDirectory, 'request-handlers'))
            .resolves([
                { name: 'page.js', isFile: () => true },
            ]);

        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'request-handlers', 'page.js'))
            .resolves({ default: pageHandler });

        // Error handlers directory
        fileSystem.readDirectory
            .withArgs(path.join(pluginDirectory, 'error-handlers'))
            .resolves([
                { name: 'error.js', isFile: () => true },
            ]);

        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'error-handlers', 'error.js'))
            .resolves({ default: errorHandler });

        plugin = new Plugin(fileSystem, pluginDirectory);
        await plugin.load();
    });

    after(() => {
        sinon.restore();
    });

    it('sets the filepath', () => {
        assertEqual(path.join(pluginDirectory, 'plugin.js'), plugin.filepath);
    });

    it('sets the register function', () => {
        assertEqual(register, plugin.register);
    });

    it('sets the initialize function', () => {
        assertEqual(initialize, plugin.initialize);
    });

    it('loads collections keyed by collection name', () => {
        assertEqual(1, plugin.collections.size);
        assert(plugin.collections.has('User'));
    });

    it('loads middleware keyed by function name', () => {
        assertEqual(1, plugin.middleware.size);
        assert(plugin.middleware.has('authMiddleware'));
    });

    it('loads request handlers keyed by function name', () => {
        assertEqual(1, plugin.requestHandlers.size);
        assert(plugin.requestHandlers.has('pageHandler'));
    });

    it('loads error handlers keyed by function name', () => {
        assertEqual(1, plugin.errorHandlers.size);
        assert(plugin.errorHandlers.has('errorHandler'));
    });

    it('returns the plugin instance', async () => {
        const result = await new Plugin(fileSystem, pluginDirectory).load();
        assertEqual('my-plugin', result.name);
    });
});


describe('Plugin#load without plugin module file', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub(),
    };

    let plugin;

    before(async () => {
        plugin = new Plugin(fileSystem, pluginDirectory);
        await plugin.load();
    });

    after(() => {
        sinon.restore();
    });

    it('sets filepath to null', () => {
        assertEqual(null, plugin.filepath);
    });

    it('sets register to null', () => {
        assertEqual(null, plugin.register);
    });

    it('sets initialize to null', () => {
        assertEqual(null, plugin.initialize);
    });
});


describe('Plugin#load when plugin module has no register or initialize', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub(),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub(),
    };

    let plugin;

    before(async () => {
        fileSystem.readDirectory.resolves([]);
        fileSystem.readDirectory
            .withArgs(pluginDirectory)
            .resolves([
                { name: 'plugin.js', isFile: () => true },
            ]);

        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'plugin.js'))
            .resolves({ someOtherExport: 'value' });

        plugin = new Plugin(fileSystem, pluginDirectory);
        await plugin.load();
    });

    after(() => {
        sinon.restore();
    });

    it('sets register to null', () => {
        assertEqual(null, plugin.register);
    });

    it('sets initialize to null', () => {
        assertEqual(null, plugin.initialize);
    });
});


describe('Plugin#load when plugin module fails to load', ({ before, after, it }) => {
    const pluginDirectory = '/path/to/my-plugin';

    const fileSystem = {
        readDirectory: sinon.stub(),
        readJSONFile: sinon.stub(),
        importAbsoluteFilepath: sinon.stub(),
    };

    let error;

    before(async () => {
        fileSystem.readDirectory.resolves([]);
        fileSystem.readDirectory
            .withArgs(pluginDirectory)
            .resolves([
                { name: 'plugin.js', isFile: () => true },
            ]);

        fileSystem.importAbsoluteFilepath
            .withArgs(path.join(pluginDirectory, 'plugin.js'))
            .rejects(new Error('Module syntax error'));

        const plugin = new Plugin(fileSystem, pluginDirectory);

        try {
            await plugin.load();
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

    it('includes the filepath in the error message', () => {
        assert(error.message.includes(path.join(pluginDirectory, 'plugin.js')));
    });

    it('includes the original error as cause', () => {
        assert(error.cause);
        assertEqual('Module syntax error', error.cause.message);
    });
});
