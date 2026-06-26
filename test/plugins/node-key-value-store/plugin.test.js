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

    it('registers the key value store using the OS-resolved path', async () => {
        const directory = await makeTempDir();
        const sqlitePath = path.join(directory, 'key_value_store.sqlite');
        const registered = {};
        const tracker = new MockTracker();
        // The store config is read from config.env, and the relative path is
        // mapped to an absolute OS path through config.resolveFilepath. The stub
        // returns the temp sqlite path to stand in for that resolution.
        const resolveFilepath = tracker.fn(() => sqlitePath);

        const context = {
            logger: makeLogger(),
            config: {
                env: { KEY_VALUE_STORE: { path: '../data/key_value_store.sqlite' } },
                resolveFilepath,
            },
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);
        stores.push(registered.service);

        assertEqual('KeyValueStore', registered.name);
        // The configured (POSIX) path is what gets resolved.
        assertEqual('../data/key_value_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);

        // The registered service reads and writes against the resolved sqlite file.
        await registered.service.put(null, 'greeting', 'hello');
        assertEqual('hello', await registered.service.get(null, 'greeting'));
    });

    it('throws when the configured path is missing', () => {
        const context = {
            logger: makeLogger(),
            config: {
                env: {},
                resolveFilepath() {
                    return '/unused';
                },
            },
            registerService() {},
        };

        const error = catchError(() => register(context));

        assert(error, 'expected register to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('KEY_VALUE_STORE.path', error.message);
    });
});
