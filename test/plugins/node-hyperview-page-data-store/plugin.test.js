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

    it('registers the page data store without application config', async () => {
        const directory = await makeTempDir();
        const registered = {};
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => directory);

        const context = {
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };
        const requestContext = {
            config: {
                env: { HYPERVIEW_PAGE_DATA_STORE: { directory: './pages' } },
                resolveFilepath,
            },
        };

        register(context);

        assertEqual('HyperviewPageDataStore', registered.name);
        assertEqual(0, resolveFilepath.mock.callCount());

        await registered.service.putTextFile(requestContext, null, '/body.md', '# Body');
        assertEqual('./pages', resolveFilepath.mock.getCall(0).arguments[0]);
        assertEqual('# Body', await readBackingFile(directory, 'body.md'));
    });

    it('throws from the registered service when the request config directory is missing', async () => {
        const registered = {};
        const context = {
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);

        const error = await catchAsyncError(() => {
            return registered.service.getTextFile({ config: { env: {} } }, null, '/missing.md');
        });

        assert(error, 'expected service operation to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('HYPERVIEW_PAGE_DATA_STORE.directory', error.message);
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
