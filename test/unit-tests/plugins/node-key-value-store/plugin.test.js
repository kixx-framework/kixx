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

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
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

    it('registers the key value store from application config', async () => {
        const directory = await makeTempDir();
        const sqlitePath = path.join(directory, 'key_value_store.sqlite');
        const registered = {};
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => sqlitePath);

        const context = {
            config: {
                env: { KEY_VALUE_STORE: { path: '../data/key_value_store.sqlite' } },
                resolveFilepath,
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);
        stores.push(registered.service);

        assertEqual('KeyValueStore', registered.name);
        assertEqual(1, resolveFilepath.mock.callCount());
        assertEqual('../data/key_value_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);

        await registered.service.put(null, 'greeting', 'hello');
        assertEqual('hello', await registered.service.get(null, 'greeting'));
    });

    it('throws during registration when the application config path is missing', () => {
        const registered = {};
        const context = {
            config: {
                env: {},
                resolveFilepath(filepath) {
                    return filepath;
                },
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        const error = catchError(() => register(context));

        assert(error, 'expected registration to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('KEY_VALUE_STORE.path', error.message);
    });

    it('throws during registration when resolveFilepath is missing', () => {
        const registered = {};
        const context = {
            config: {
                env: { KEY_VALUE_STORE: { path: '../data/key_value_store.sqlite' } },
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        const error = catchError(() => register(context));

        assert(error, 'expected registration to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('resolveFilepath', error.message);
    });
});
