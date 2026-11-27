import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, MockTracker } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../../../kixx/adapters/node/content-store/plugin.js';
import { FORMAT } from '../../../../../kixx/content-addressable-store/addressing.js';
import Logger from '../../../../../kixx/logger/logger.js';


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

function makeContext(contentStoreConfig, resolveFilepath, environment) {
    const registered = {};
    return {
        context: {
            config: {
                environment,
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

        await registered.service.saveIndex({ logger: makeLogger() }, 'root', { '/': [ 'tree', 'root' ] });
        assertEqual('directory', (await fsp.stat(rootDirectory)).isDirectory() ? 'directory' : 'missing');
        assertEqual('file', (await fsp.stat(path.join(rootDirectory, `format-${ FORMAT }`, 'index.sqlite'))).isFile() ? 'file' : 'missing');
    });

    it('registers the ordinary ContentStore in development', async () => {
        const temporaryDirectory = await makeTemporaryDirectory();
        const rootDirectory = path.join(temporaryDirectory, 'content-store');
        const { context, registered } = makeContext({ rootDirectory: './content-store' }, () => rootDirectory, 'development');

        register(context);
        stores.push(registered.service);

        assertEqual('ContentStore', registered.name);
        assertEqual('ContentStore', registered.service.constructor.name);

        // It is writable, as in every environment.
        await registered.service.saveIndex({ logger: makeLogger() }, 'root', { '/': [ 'tree', 'root' ] });
        assertEqual(true, (await fsp.stat(path.join(rootDirectory, `format-${ FORMAT }`, 'index.sqlite'))).isFile());
    });

    it('requires a root directory in development too', () => {
        const { context } = makeContext({}, (value) => value, 'development');

        const error = catchError(() => register(context));

        assertEqual('AssertionError', error.name);
        assertMatches('CONTENT_STORE.rootDirectory', error.message);
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
