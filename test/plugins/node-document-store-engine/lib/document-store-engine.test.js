import { DatabaseSync } from 'node:sqlite';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe } from 'kixx-test';
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

        it('throws when neither a database nor path is provided', () => {
            const caught = catchError(() => new DocumentStoreEngine({ logger: makeLogger() }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('database or path', caught.message);
        });

        it('throws when an explicit path is empty', () => {
            const caught = catchError(() => new DocumentStoreEngine({ logger: makeLogger(), path: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('database or path', caught.message);
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

        it('keeps using the constructor path regardless of method context config', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'document_store.sqlite');
            const context = {
                config: {
                    env: { DOCUMENT_STORE: { path: './ignored.sqlite' } },
                    resolveFilepath() {
                        throw new Error('method context config should not be used');
                    },
                },
            };
            const engine = new DocumentStoreEngine({ logger: makeLogger(), path: sqlitePath });
            engine.setIndexDefinitions([]);

            await engine.put(context, { type: 'Note', id: 'n1', title: 'Hello' });
            const record = await engine.get(context, 'Note', 'n1');

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
