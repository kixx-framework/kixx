import { DatabaseSync } from 'node:sqlite';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import DocumentStoreEngine from '../../../../src/plugins/node-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../src/kixx/logger/logger.js';


const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dse-'));
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

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Node DocumentStoreEngine', ({ after, describe }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new DocumentStoreEngine({ path: ':memory:' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('DocumentStoreEngine requires a logger', caught.message);
        });

        it('allows logger-only construction for request-config-backed engines', () => {
            const engine = new DocumentStoreEngine({ logger: makeLogger() });

            engine.close();
        });

        it('throws when an explicit path is empty', () => {
            const caught = catchError(() => new DocumentStoreEngine({ logger: makeLogger(), path: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('path', caught.message);
        });
    });

    describe('request config', ({ it }) => {
        it('resolves DOCUMENT_STORE.path from the method context', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'document_store.sqlite');
            const tracker = new MockTracker();
            const resolveFilepath = tracker.fn(() => sqlitePath);
            const context = {
                config: {
                    env: { DOCUMENT_STORE: { path: '../data/document_store.sqlite' } },
                    resolveFilepath,
                },
            };
            const engine = new DocumentStoreEngine({ logger: makeLogger() });
            engine.setIndexDefinitions([]);

            await engine.put(context, { type: 'Note', id: 'n1', title: 'Hello' });
            const record = await engine.get(context, 'Note', 'n1');

            assertEqual('../data/document_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);
            assertEqual('Hello', record.doc.title);
            engine.close();
        });

        it('throws when DOCUMENT_STORE.path is missing', async () => {
            const engine = new DocumentStoreEngine({ logger: makeLogger() });
            engine.setIndexDefinitions([]);

            const caught = await catchAsyncError(() => engine.get({ config: { env: {} } }, 'Note', 'missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('DOCUMENT_STORE.path', caught.message);
            engine.close();
        });

        it('reuses the same database across requests with a stable resolved path', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'document_store.sqlite');
            const resolveFilepath = () => sqlitePath;
            const makeContext = () => {
                return {
                    config: {
                        env: { DOCUMENT_STORE: { path: '../data/document_store.sqlite' } },
                        resolveFilepath,
                    },
                };
            };
            const engine = new DocumentStoreEngine({ logger: makeLogger() });
            engine.setIndexDefinitions([]);

            // A fresh context object each request still resolves the same path, so
            // a document written on one request is visible on the next.
            await engine.put(makeContext(), { type: 'Note', id: 'same', title: 'First' });
            await engine.put(makeContext(), { type: 'Note', id: 'same', title: 'Second' });

            assertEqual('Second', (await engine.get(makeContext(), 'Note', 'same')).doc.title);
            engine.close();
        });

        it('throws when the resolved path changes after the database is opened', async () => {
            const directory = await makeTempDir();
            const firstPath = path.join(directory, 'first.sqlite');
            const secondPath = path.join(directory, 'second.sqlite');
            const resolveFilepath = (configuredPath) => {
                return configuredPath === './first.sqlite' ? firstPath : secondPath;
            };
            const firstContext = {
                config: {
                    env: { DOCUMENT_STORE: { path: './first.sqlite' } },
                    resolveFilepath,
                },
            };
            const secondContext = {
                config: {
                    env: { DOCUMENT_STORE: { path: './second.sqlite' } },
                    resolveFilepath,
                },
            };
            const engine = new DocumentStoreEngine({ logger: makeLogger() });
            engine.setIndexDefinitions([]);

            await engine.put(firstContext, { type: 'Note', id: 'same', title: 'First' });

            const caught = await catchAsyncError(() => {
                return engine.put(secondContext, { type: 'Note', id: 'same', title: 'Second' });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not change', caught.message);
            engine.close();
        });
    });

    describe('explicit database configuration', ({ it }) => {
        it('uses an explicit path without request config', async () => {
            const engine = new DocumentStoreEngine({ logger: makeLogger(), path: ':memory:' });
            engine.setIndexDefinitions([]);

            await engine.put(null, { type: 'Note', id: 'n1', title: 'Hello' });
            const record = await engine.get(null, 'Note', 'n1');

            assertEqual('Hello', record.doc.title);
            engine.close();
        });

        it('leaves a caller-owned injected database open', async () => {
            const database = new DatabaseSync(':memory:');
            const engine = new DocumentStoreEngine({ logger: makeLogger(), database });
            engine.setIndexDefinitions([]);

            await engine.put(null, { type: 'Note', id: 'n1', title: 'Hello' });
            engine.close();
            const row = database.prepare('SELECT doc FROM documents WHERE type = ? AND id = ?').get('Note', 'n1');

            assert(row, 'expected the caller-owned database to remain open');
            database.close();
        });
    });
});
