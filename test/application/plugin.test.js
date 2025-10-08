import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import Plugin from '../../lib/application/plugin.js';

import { assert, assertEqual } from 'kixx-assert';

// Mock current working directory
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));


describe('Plugin#loadViews()', ({ before, after, it }) => {

    class UserView { }

    const readDirectory = sinon.stub().resolves([
        {
            name: 'user.view.mjs',
            isDirectory() {
                return false;
            },
        },
        {
            name: 'product',
            isDirectory() {
                return true;
            },
        },
        {
            name: 'user',
            isDirectory() {
                return true;
            },
        },
        {
            name: 'helpers.js',
            isDirectory() {
                return false;
            },
        },
    ]);

    const fileSystem = { readDirectory };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);

        const loadView = sinon.stub(plugin, 'loadView');
        loadView.onFirstCall().resolves(null);
        loadView.onSecondCall().resolves(UserView);

        result = await plugin.loadViews();
    });

    after(() => {
        sinon.restore();
    });

    it('only loads nested directories', () => {
        assertEqual(2, plugin.loadView.callCount);
        assertEqual(path.join(DIRECTORY, 'views', 'product'), plugin.loadView.getCall(0).args[0]);
        assertEqual(path.join(DIRECTORY, 'views', 'user'), plugin.loadView.getCall(1).args[0]);
    });

    it('uses the plugin name and ViewConstructor.name as the key', () => {
        assertEqual(1, result.size);
        assert(result.has('application.UserView'));
    });
});

describe('Plugin#loadView()', ({ before, after, it }) => {

    class UserView { }

    const directory = path.join(DIRECTORY, 'views', 'user');

    const schema = {
        type: 'object',
        properties: {
            name: { type: 'string' },
            email: { type: 'string' },
        },
    };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'user.view.mjs',
            isFile() {
                return true;
            },
        },
        {
            name: 'user.schema.json',
            isFile() {
                return true;
            },
        },
        {
            name: 'README.md',
            isFile() {
                return true;
            },
        },
        {
            name: 'helpers.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'subdir.view.js',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(schema);
    const importAbsoluteFilepath = sinon.stub().resolves({ default: UserView });

    const fileSystem = {
        readDirectory,
        readJSONFile,
        importAbsoluteFilepath,
    };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadView(directory);
    });

    after(() => {
        sinon.restore();
    });

    it('only loads JS and schema JSON files', () => {
        assertEqual(1, readJSONFile.callCount);
        assertEqual(path.join(directory, 'user.schema.json'), readJSONFile.getCall(0).args[0]);

        assertEqual(1, importAbsoluteFilepath.callCount);
        assertEqual(path.join(directory, 'user.view.mjs'), importAbsoluteFilepath.getCall(0).args[0]);
    });

    it('attaches the schema to the constructor function', () => {
        assertEqual(schema, UserView.schema);
    });

    it('returns the default export constructor function', () => {
        assertEqual(UserView, result);
    });
});

describe('Plugin#loadView() when class file does not exist', ({ before, after, it }) => {

    const directory = path.join(DIRECTORY, 'views', 'incomplete');

    const schema = {
        type: 'object',
        properties: {
            name: { type: 'string' },
        },
    };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'incomplete.schema.json',
            isFile() {
                return true;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(schema);
    const importAbsoluteFilepath = sinon.stub();

    const fileSystem = {
        readDirectory,
        readJSONFile,
        importAbsoluteFilepath,
    };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadView(directory);
    });

    after(() => {
        sinon.restore();
    });

    it('does not attempt to import a class file', () => {
        assertEqual(0, importAbsoluteFilepath.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('Plugin#loadForms()', ({ before, after, it }) => {

    class UserForm { }

    const readDirectory = sinon.stub().resolves([
        {
            name: 'user.form.mjs',
            isDirectory() {
                return false;
            },
        },
        {
            name: 'product',
            isDirectory() {
                return true;
            },
        },
        {
            name: 'user',
            isDirectory() {
                return true;
            },
        },
        {
            name: 'helpers.js',
            isDirectory() {
                return false;
            },
        },
    ]);

    const fileSystem = { readDirectory };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);

        const loadForm = sinon.stub(plugin, 'loadForm');
        loadForm.onFirstCall().resolves(null);
        loadForm.onSecondCall().resolves(UserForm);

        result = await plugin.loadForms();
    });

    after(() => {
        sinon.restore();
    });

    it('only loads nested directories', () => {
        assertEqual(2, plugin.loadForm.callCount);
        assertEqual(path.join(DIRECTORY, 'forms', 'product'), plugin.loadForm.getCall(0).args[0]);
        assertEqual(path.join(DIRECTORY, 'forms', 'user'), plugin.loadForm.getCall(1).args[0]);
    });

    it('uses the plugin name and FormConstructor.name as the key', () => {
        assertEqual(1, result.size);
        assert(result.has('application.UserForm'));
    });
});

describe('Plugin#loadForm()', ({ before, after, it }) => {

    class UserForm { }

    const directory = path.join(DIRECTORY, 'forms', 'user');

    const schema = {
        type: 'object',
        properties: {
            username: { type: 'string' },
            password: { type: 'string' },
        },
    };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'user.form.mjs',
            isFile() {
                return true;
            },
        },
        {
            name: 'user.schema.json',
            isFile() {
                return true;
            },
        },
        {
            name: 'README.md',
            isFile() {
                return true;
            },
        },
        {
            name: 'helpers.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'subdir.form.js',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(schema);
    const importAbsoluteFilepath = sinon.stub().resolves({ default: UserForm });

    const fileSystem = {
        readDirectory,
        readJSONFile,
        importAbsoluteFilepath,
    };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadForm(directory);
    });

    after(() => {
        sinon.restore();
    });

    it('only loads JS and schema JSON files', () => {
        assertEqual(1, readJSONFile.callCount);
        assertEqual(path.join(directory, 'user.schema.json'), readJSONFile.getCall(0).args[0]);

        assertEqual(1, importAbsoluteFilepath.callCount);
        assertEqual(path.join(directory, 'user.form.mjs'), importAbsoluteFilepath.getCall(0).args[0]);
    });

    it('attaches the schema to the constructor function', () => {
        assertEqual(schema, UserForm.schema);
    });

    it('returns the default export constructor function', () => {
        assertEqual(UserForm, result);
    });
});

describe('Plugin#loadForm() when class file does not exist', ({ before, after, it }) => {

    const directory = path.join(DIRECTORY, 'forms', 'incomplete');

    const schema = {
        type: 'object',
        properties: {
            name: { type: 'string' },
        },
    };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'incomplete.schema.json',
            isFile() {
                return true;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(schema);
    const importAbsoluteFilepath = sinon.stub();

    const fileSystem = {
        readDirectory,
        readJSONFile,
        importAbsoluteFilepath,
    };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadForm(directory);
    });

    after(() => {
        sinon.restore();
    });

    it('does not attempt to import a class file', () => {
        assertEqual(0, importAbsoluteFilepath.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('Plugin#loadCollections()', ({ before, after, it }) => {

    class User { }

    class UserCollection {
        static Model = User;
    }

    const readDirectory = sinon.stub().resolves([
        {
            name: 'user.collection.mjs',
            isDirectory() {
                return false;
            },
        },
        {
            name: 'product',
            isDirectory() {
                return true;
            },
        },
        {
            name: 'user',
            isDirectory() {
                return true;
            },
        },
        {
            name: 'helpers.js',
            isDirectory() {
                return false;
            },
        },
    ]);

    const fileSystem = { readDirectory };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);

        const loadCollection = sinon.stub(plugin, 'loadCollection');
        loadCollection.onFirstCall().resolves(null);
        loadCollection.onSecondCall().resolves(UserCollection);

        result = await plugin.loadCollections();
    });

    after(() => {
        sinon.restore();
    });

    it('only loads nested directories', () => {
        assertEqual(2, plugin.loadCollection.callCount);
        assertEqual(path.join(DIRECTORY, 'collections', 'product'), plugin.loadCollection.getCall(0).args[0]);
        assertEqual(path.join(DIRECTORY, 'collections', 'user'), plugin.loadCollection.getCall(1).args[0]);
    });

    it('uses the plugin name and Model.name as the key', () => {
        assertEqual(1, result.size);
        assert(result.has('application.User'));
    });
});

describe('Plugin#loadCollection()', ({ before, after, it }) => {

    class User {
        static name = 'User';
    }

    class UserCollection {
        static Model = User;
    }

    const directory = path.join(DIRECTORY, 'collections', 'user');

    const schema = {
        type: 'object',
        properties: {
            username: { type: 'string' },
            email: { type: 'string' },
        },
    };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'user.collection.mjs',
            isFile() {
                return true;
            },
        },
        {
            name: 'user.schema.json',
            isFile() {
                return true;
            },
        },
        {
            name: 'README.md',
            isFile() {
                return true;
            },
        },
        {
            name: 'helpers.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'subdir.collection.js',
            isFile() {
                return false;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(schema);
    const importAbsoluteFilepath = sinon.stub().resolves({ default: UserCollection });

    const fileSystem = {
        readDirectory,
        readJSONFile,
        importAbsoluteFilepath,
    };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadCollection(directory);
    });

    after(() => {
        sinon.restore();
    });

    it('only loads JS and schema JSON files', () => {
        assertEqual(1, readJSONFile.callCount);
        assertEqual(path.join(directory, 'user.schema.json'), readJSONFile.getCall(0).args[0]);

        assertEqual(1, importAbsoluteFilepath.callCount);
        assertEqual(path.join(directory, 'user.collection.mjs'), importAbsoluteFilepath.getCall(0).args[0]);
    });

    it('attaches the schema to the constructor function', () => {
        assertEqual(schema, UserCollection.schema);
    });

    it('returns the default export constructor function', () => {
        assertEqual(UserCollection, result);
    });
});

describe('Plugin#loadCollection() when class file does not exist', ({ before, after, it }) => {

    const directory = path.join(DIRECTORY, 'collections', 'incomplete');

    const schema = {
        type: 'object',
        properties: {
            name: { type: 'string' },
        },
    };

    const readDirectory = sinon.stub().resolves([
        {
            name: 'incomplete.schema.json',
            isFile() {
                return true;
            },
        },
    ]);

    const readJSONFile = sinon.stub().resolves(schema);
    const importAbsoluteFilepath = sinon.stub();

    const fileSystem = {
        readDirectory,
        readJSONFile,
        importAbsoluteFilepath,
    };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadCollection(directory);
    });

    after(() => {
        sinon.restore();
    });

    it('does not attempt to import a class file', () => {
        assertEqual(0, importAbsoluteFilepath.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('Plugin#loadMiddlewareDirectory()', ({ before, after, it }) => {

    function SomeMiddleware() {}
    function OtherMiddleware() {}

    const dirpath = path.join(DIRECTORY, 'middleware');

    const readDirectory = sinon.stub().resolves([
        {
            name: 'subdir',
            isFile() {
                return false;
            },
        },
        {
            name: 'some-middleware.mjs',
            isFile() {
                return true;
            },
        },
        {
            name: 'other-middleware.js',
            isFile() {
                return true;
            },
        },
        {
            name: 'docs.md',
            isFile() {
                return true;
            },
        },
    ]);

    const fileSystem = { readDirectory };

    let plugin;
    let result;

    before(async () => {
        plugin = new Plugin(fileSystem, DIRECTORY);

        const loadMiddlewareFunction = sinon.stub(plugin, 'loadMiddlewareFunction');
        loadMiddlewareFunction.onFirstCall().resolves(SomeMiddleware);
        loadMiddlewareFunction.onSecondCall().resolves(OtherMiddleware);

        result = await plugin.loadMiddlewareDirectory(dirpath);
    });

    after(() => {
        sinon.restore();
    });

    it('calls readDirectory', () => {
        assertEqual(1, readDirectory.callCount);
        assertEqual(dirpath, readDirectory.getCall(0).args[0]);
    });

    it('only attempts to load JS files', () => {
        const loadMiddlewareFunction = plugin.loadMiddlewareFunction;
        assertEqual(2, loadMiddlewareFunction.callCount);
        assertEqual(path.join(dirpath, 'some-middleware.mjs'), loadMiddlewareFunction.getCall(0).args[0]);
        assertEqual(path.join(dirpath, 'other-middleware.js'), loadMiddlewareFunction.getCall(1).args[0]);
    });

    it('namespaces the resulting map keys', () => {
        assertEqual(2, result.size);
        assert(result.has(`application.SomeMiddleware`));
        assert(result.has(`application.OtherMiddleware`));
    });
});

describe('Plugin#loadMiddlewareFunction()', ({ before, after, it }) => {

    function SomeMiddleware() {}

    const filepath = path.join(DIRECTORY, 'some-middleware.js');

    const importAbsoluteFilepath = sinon.stub().resolves({ default: SomeMiddleware });

    const fileSystem = { importAbsoluteFilepath };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadMiddlewareFunction(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('calls importAbsoluteFilepath()', () => {
        assertEqual(1, importAbsoluteFilepath.callCount);
        assertEqual(filepath, importAbsoluteFilepath.getCall(0).args[0]);
    });

    it('returns the default exports', () => {
        assertEqual(SomeMiddleware, result);
    });
});

describe('Plugin#loadMiddlewareFunction() when default export is not a function', ({ before, after, it }) => {

    const filepath = path.join(DIRECTORY, 'some-middleware.js');

    const importAbsoluteFilepath = sinon.stub().resolves({ default: {} });

    const fileSystem = { importAbsoluteFilepath };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, DIRECTORY);

        try {
            await plugin.loadMiddlewareFunction(filepath);
        } catch (err) {
            result = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws an AssertionError', () => {
        assertEqual('AssertionError', result.name);
    });
});

describe('Plugin#loadMiddlewareFunction() when import throws', ({ before, after, it }) => {

    const error = new Error('import error');
    const filepath = path.join(DIRECTORY, 'some-middleware.js');

    const importAbsoluteFilepath = sinon.stub().rejects(error);

    const fileSystem = { importAbsoluteFilepath };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, DIRECTORY);

        try {
            await plugin.loadMiddlewareFunction(filepath);
        } catch (err) {
            result = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws a WrappedError', () => {
        assertEqual('WrappedError', result.name);
        assertEqual(error, result.cause);
    });
});
