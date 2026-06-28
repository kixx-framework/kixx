import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../src/plugins/node-static-file-server/plugin.js';
import Logger from '../../../src/kixx/logger/logger.js';


const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-sfs-plugin-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('node-static-file-server plugin', ({ after, it }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('registers the static file store without application config', async () => {
        const directory = await makeTempDir();
        await fsp.writeFile(path.join(directory, 'site.css'), 'body{}', 'utf8');
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
                env: { STATIC_FILE_STORE: { directory: './public' } },
                resolveFilepath,
            },
        };

        register(context);

        assertEqual('StaticFileStore', registered.name);
        assertEqual(0, resolveFilepath.mock.callCount());

        const result = await registered.service.read(requestContext, {
            key: 'site.css',
            namespace: null,
            computeEtag: false,
        });

        assert(result, 'expected static file result');
        assertEqual('./public', resolveFilepath.mock.getCall(0).arguments[0]);
        assertEqual('text/css; charset=utf-8', result.contentType);
        assertEqual(6, result.contentLength);
        await result.body.cancel();
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
            return registered.service.read({ config: { env: {} } }, {
                key: 'missing.css',
                namespace: null,
                computeEtag: false,
            });
        });

        assert(error, 'expected service operation to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('STATIC_FILE_STORE.directory', error.message);
    });
});
