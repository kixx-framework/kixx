import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../src/plugins/node-hyperview-template-file-store/plugin.js';
import Logger from '../../../src/kixx/logger/logger.js';


const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-tfs-plugin-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

async function readBackingFile(directory, relativePath) {
    return fsp.readFile(path.join(directory, relativePath), 'utf8');
}


describe('node-hyperview-template-file-store plugin', ({ after, it }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('registers the template file store with application config', async () => {
        const directory = await makeTempDir();
        const registered = {};
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => directory);

        const context = {
            config: {
                env: { HYPERVIEW_TEMPLATE_FILE_STORE: { directory: './templates' } },
                resolveFilepath,
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);

        assertEqual('HyperviewTemplateFileStore', registered.name);
        assertEqual(1, resolveFilepath.mock.callCount());
        assertEqual('./templates', resolveFilepath.mock.getCall(0).arguments[0]);

        await registered.service.putBaseTemplate(null, null, 'website.html', '<html></html>');
        assertEqual('<html></html>', await readBackingFile(directory, 'base/website.html'));
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
        assertMatches('HYPERVIEW_TEMPLATE_FILE_STORE.directory', error.message);
    });

    it('throws during registration when resolveFilepath is missing', () => {
        const context = {
            config: {
                env: { HYPERVIEW_TEMPLATE_FILE_STORE: { directory: './templates' } },
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
