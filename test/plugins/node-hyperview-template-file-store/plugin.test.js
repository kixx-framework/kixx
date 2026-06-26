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

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
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

    it('registers the template file store using the OS-resolved directory', async () => {
        const directory = await makeTempDir();
        const registered = {};
        const tracker = new MockTracker();
        // The store config is read from config.env, and the relative directory
        // is mapped to an absolute OS path through config.resolveFilepath. The
        // stub returns the temp dir to stand in for that resolution.
        const resolveFilepath = tracker.fn(() => directory);

        const context = {
            logger: makeLogger(),
            config: {
                env: { TEMPLATE_FILE_STORE: { directory: './templates' } },
                resolveFilepath,
            },
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);

        assertEqual('HyperviewTemplateFileStore', registered.name);
        // The configured (POSIX) directory is what gets resolved.
        assertEqual('./templates', resolveFilepath.mock.getCall(0).arguments[0]);

        // The registered service writes to the resolved directory; base templates
        // land under the `base/` prefix.
        await registered.service.putBaseTemplate(null, null, 'website.html', '<html></html>');
        assertEqual('<html></html>', await readBackingFile(directory, 'base/website.html'));
    });

    it('throws when the configured directory is missing', () => {
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
        assertMatches('TEMPLATE_FILE_STORE.directory', error.message);
    });
});
