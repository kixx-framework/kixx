import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../src/plugins/node-hyperview-page-data-store/plugin.js';
import Logger from '../../../src/kixx/logger/logger.js';


const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-pds-plugin-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

async function readBackingFile(directory, relativePath) {
    return fsp.readFile(path.join(directory, relativePath), 'utf8');
}


describe('node-hyperview-page-data-store plugin', ({ after, it }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('registers the page data store with application config', async () => {
        const directory = await makeTempDir();
        const registered = {};
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => directory);

        const context = {
            config: {
                env: { HYPERVIEW_PAGE_DATA_STORE: { directory: './pages' } },
                resolveFilepath,
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);

        assertEqual('HyperviewPageDataStore', registered.name);
        assertEqual(1, resolveFilepath.mock.callCount());
        assertEqual('./pages', resolveFilepath.mock.getCall(0).arguments[0]);

        await registered.service.putTextFile(null, null, '/body.md', '# Body');
        assertEqual('# Body', await readBackingFile(directory, 'body.md'));
    });

    it('throws during registration when the application config directory is missing', () => {
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

        assert(error, 'expected service operation to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('HYPERVIEW_PAGE_DATA_STORE.directory', error.message);
    });

    it('throws during registration when resolveFilepath is missing', () => {
        const context = {
            config: {
                env: { HYPERVIEW_PAGE_DATA_STORE: { directory: './pages' } },
            },
            logger: makeLogger(),
            registerService() {},
        };

        const error = catchError(() => register(context));

        assert(error, 'expected service operation to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('resolveFilepath', error.message);
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
