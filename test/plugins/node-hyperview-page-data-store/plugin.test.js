import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

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

    it('registers the page data store service with the configured directory', async () => {
        const directory = await makeTempDir();
        const registered = {};
        const context = {
            logger: makeLogger(),
            env: {
                PAGE_DATA_STORE: { directory },
            },
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);

        assertEqual('HyperviewPageDataStore', registered.name);
        await registered.service.putTextFile(null, null, '/body.md', '# Body');
        assertEqual('# Body', await readBackingFile(directory, 'body.md'));
    });
});
