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

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
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

    it('registers the document store engine from application config', async () => {
        const directory = await makeTempDir();
        const sqlitePath = path.join(directory, 'document_store.sqlite');
        const registered = {};
        const tracker = new MockTracker();
        const resolveFilepath = tracker.fn(() => sqlitePath);

        const context = {
            config: {
                env: { DOCUMENT_STORE: { path: '../data/document_store.sqlite' } },
                resolveFilepath,
            },
            logger: makeLogger(),
            registerService(name, service) {
                registered.name = name;
                registered.service = service;
            },
        };

        register(context);
        engines.push(registered.service);
        registered.service.setIndexDefinitions([]);

        assertEqual('DocumentStoreEngine', registered.name);
        assertEqual(1, resolveFilepath.mock.callCount());
        assertEqual('../data/document_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);

        await registered.service.put(null, { type: 'Note', id: 'n1', title: 'Hello' });
        const record = await registered.service.get(null, 'Note', 'n1');

        assertEqual('Hello', record.doc.title);
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
        assertMatches('DOCUMENT_STORE.path', error.message);
    });

    it('throws during registration when resolveFilepath is missing', () => {
        const registered = {};
        const context = {
            config: {
                env: { DOCUMENT_STORE: { path: '../data/document_store.sqlite' } },
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
