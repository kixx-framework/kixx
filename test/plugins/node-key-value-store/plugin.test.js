import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../src/plugins/node-key-value-store/plugin.js';
import Logger from '../../../src/kixx/logger/logger.js';


const tempDirs = [];
const stores = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-kv-plugin-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

describe('node-key-value-store plugin', ({ after, it }) => {

    after(async () => {
        // Release any SQLite connections before removing their backing files.
        for (const store of stores) {
            store.close();
        }
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('registers the key value store without application config', async () => {
        const directory = await makeTempDir();
        const sqlitePath = path.join(directory, 'key_value_store.sqlite');
        const registered = {};
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => sqlitePath);

        const context = {
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };
        const requestContext = {
            config: {
                env: { KEY_VALUE_STORE: { path: '../data/key_value_store.sqlite' } },
                resolveFilepath,
            },
        };

        register(context);
        stores.push(registered.service);

        assertEqual('KeyValueStore', registered.name);
        assertEqual(0, resolveFilepath.mock.callCount());

        await registered.service.put(requestContext, 'greeting', 'hello');
        assertEqual('../data/key_value_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);
        assertEqual('hello', await registered.service.get(requestContext, 'greeting'));
    });

    it('throws from the registered service when the request config path is missing', async () => {
        const registered = {};
        const context = {
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);
        stores.push(registered.service);

        const error = await catchAsyncError(() => registered.service.get({ config: { env: {} } }, 'missing'));

        assert(error, 'expected service operation to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('KEY_VALUE_STORE.path', error.message);
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
