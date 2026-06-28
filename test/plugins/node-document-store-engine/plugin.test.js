import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../src/plugins/node-document-store-engine/plugin.js';
import Logger from '../../../src/kixx/logger/logger.js';


const tempDirs = [];
const engines = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dse-plugin-'));
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


describe('node-document-store-engine plugin', ({ after, it }) => {

    after(async () => {
        for (const engine of engines) {
            engine.close();
        }
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('registers the document store engine without application config', async () => {
        const directory = await makeTempDir();
        const sqlitePath = path.join(directory, 'document_store.sqlite');
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
                env: { DOCUMENT_STORE: { path: '../data/document_store.sqlite' } },
                resolveFilepath,
            },
        };

        register(context);
        engines.push(registered.service);
        registered.service.setIndexDefinitions([]);

        assertEqual('DocumentStoreEngine', registered.name);
        assertEqual(0, resolveFilepath.mock.callCount());

        await registered.service.put(requestContext, { type: 'Note', id: 'n1', title: 'Hello' });
        const record = await registered.service.get(requestContext, 'Note', 'n1');

        assertEqual('../data/document_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);
        assertEqual('Hello', record.doc.title);
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
        engines.push(registered.service);
        registered.service.setIndexDefinitions([]);

        const error = await catchAsyncError(() => {
            return registered.service.get({ config: { env: {} } }, 'Note', 'missing');
        });

        assert(error, 'expected service operation to throw');
        assertEqual('AssertionError', error.name);
        assertMatches('DOCUMENT_STORE.path', error.message);
    });
});
