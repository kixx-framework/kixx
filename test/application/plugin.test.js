import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import Plugin from '../../lib/application/plugin.js';

import { assert, assertEqual } from 'kixx-assert';

// Mock current working directory
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));


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
