import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../../src/plugins/node-content-store/plugin.js';
import { plugins } from '../../../../src/plugins/node.js';
import { FORMAT } from '../../../../src/kixx/content-addressable-store/addressing.js';
import Logger from '../../../../src/kixx/logger/logger.js';


const temporaryDirectories = [];
const stores = [];

async function makeTemporaryDirectory() {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-content-store-plugin-'));
    temporaryDirectories.push(directory);
    return directory;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeContext(contentStoreConfig, resolveFilepath) {
    const registered = {};
    return {
        context: {
            config: {
                env: { CONTENT_STORE: contentStoreConfig },
                resolveFilepath,
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        },
        registered,
    };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('node-content-store plugin', ({ after, it }) => {

    after(async () => {
        for (const store of stores) {
            store.close();
        }
        for (const directory of temporaryDirectories) {
            await fsp.rm(directory, { recursive: true, force: true });
        }
    });

    it('is registered in the Node platform plugin registry', () => {
        assert(plugins.has('nodeContentStore'));
    });

    it('registers a configured ContentStore without touching its storage directory', async () => {
        const temporaryDirectory = await makeTemporaryDirectory();
        const rootDirectory = path.join(temporaryDirectory, 'content-store');
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => rootDirectory);
        const { context, registered } = makeContext({
            rootDirectory: '../data/content-store',
            sqliteOptions: { enableForeignKeyConstraints: true },
        }, resolveFilepath);

        register(context);
        stores.push(registered.service);

        assertEqual('ContentStore', registered.name);
        assertEqual(1, resolveFilepath.mock.callCount());
        assertEqual('../data/content-store', resolveFilepath.mock.getCall(0).arguments[0]);
        const missingBeforeUse = await catchAsyncError(() => fsp.stat(rootDirectory));
        assertEqual('ENOENT', missingBeforeUse.code);

        await registered.service.saveIndex({}, 'root', { '/': [ 'tree', 'root' ] });
        assertEqual('directory', (await fsp.stat(rootDirectory)).isDirectory() ? 'directory' : 'missing');
        assertEqual('file', (await fsp.stat(path.join(rootDirectory, `format-${ FORMAT }`, 'index.sqlite'))).isFile() ? 'file' : 'missing');
    });

    it('rejects missing configured root directories and resolvers', () => {
        const missingPath = makeContext({}, (value) => value);
        const missingResolver = makeContext({ rootDirectory: '../data/content-store' }, undefined);

        const pathError = catchError(() => register(missingPath.context));
        const resolverError = catchError(() => register(missingResolver.context));

        assertEqual('AssertionError', pathError.name);
        assertMatches('CONTENT_STORE.rootDirectory', pathError.message);
        assertEqual('AssertionError', resolverError.name);
        assertMatches('resolveFilepath', resolverError.message);
    });

    it('rejects empty paths returned by the resolver', () => {
        const { context } = makeContext({ rootDirectory: '../data/content-store' }, () => '');

        const error = catchError(() => register(context));

        assertEqual('AssertionError', error.name);
        assertMatches('resolveFilepath', error.message);
    });
});

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
