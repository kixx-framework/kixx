import { DatabaseSync } from 'node:sqlite';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import Collection from '../../../../../src/app/collections/base-document-store-collection.js';
import DocumentStore from '../../../../../src/kixx/document-store/document-store.js';
import DocumentStoreEngine from '../../../../../src/plugins/node-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../../src/kixx/logger/logger.js';


const tempDirs = [];

class NoteCollection extends Collection {

    static TYPE = 'Note';

}

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

    describe('record metadata', ({ it }) => {
        it('persists metadata outside the JSON payload and returns one record shape from every method', async () => {
            const database = new DatabaseSync(':memory:');
            const engine = new DocumentStoreEngine({ logger: makeLogger(), database });
            engine.setIndexDefinitions([
                { name: 'by_title', jsonPath: '$.title' },
            ]);

            const created = await engine.create(null, {
                type: 'Note',
                id: 'n1',
                sortKey: 'b',
                title: 'Beta',
            });
            const put = await engine.put(null, {
                type: 'Note',
                id: 'n2',
                sortKey: 'a',
                title: 'Alpha',
            });
            const updated = await engine.update(null, {
                type: 'Note',
                id: 'n1',
                sortKey: 'b',
                title: 'Beta 2',
            }, created.version);
            const loaded = await engine.get(null, 'Note', 'n1');
            const scan = await engine.scan(null, 'Note');
            const query = await engine.query(null, 'Note', { index: 'by_title' });

            const records = [
                created,
                put,
                updated,
                loaded,
                ...scan.records,
                ...query.records,
            ];
            for (const record of records) {
                assertEqual(
                    'createdAt,doc,id,sortKey,type,updatedAt,version',
                    Object.keys(record).sort().join(','),
                );
                assertUndefined(record.key);
                assertUndefined(record.doc.type);
                assertUndefined(record.doc.id);
                assertUndefined(record.doc.sortKey);
            }

            assertEqual('b', created.sortKey);
            assertEqual('a', put.sortKey);
            assertEqual('b', updated.sortKey);
            assertEqual('b', loaded.sortKey);
            assertEqual('n2', scan.records[0].id);
            assertEqual('a', scan.records[0].sortKey);
            assertEqual('n2', query.records[0].id);
            assertEqual('a', query.records[0].sortKey);

            const rows = database
                .prepare('SELECT id, sort_key, doc FROM documents ORDER BY id')
                .all();
            assertEqual('b', rows[0].sort_key);
            assertEqual('Beta 2', JSON.parse(rows[0].doc).title);
            assertUndefined(JSON.parse(rows[0].doc).type);
            assertUndefined(JSON.parse(rows[0].doc).id);
            assertUndefined(JSON.parse(rows[0].doc).sortKey);
            assertEqual('a', rows[1].sort_key);

            engine.close();
            database.close();
        });

        it('strips stale metadata from legacy JSON while keeping the column sort key', async () => {
            const database = new DatabaseSync(':memory:');
            const engine = new DocumentStoreEngine({ logger: makeLogger(), database });
            engine.setIndexDefinitions([]);

            await engine.put(null, {
                type: 'Note',
                id: 'n1',
                sortKey: 'column-key',
                title: 'Legacy',
            });
            database
                .prepare('UPDATE documents SET doc = ? WHERE type = ? AND id = ?')
                .run(JSON.stringify({
                    type: 'StaleType',
                    id: 'stale-id',
                    sortKey: 'stale-key',
                    title: 'Legacy',
                }), 'Note', 'n1');

            const record = await engine.get(null, 'Note', 'n1');

            assertEqual('Note', record.type);
            assertEqual('n1', record.id);
            assertEqual('column-key', record.sortKey);
            assertEqual('Legacy', record.doc.title);
            assertUndefined(record.doc.type);
            assertUndefined(record.doc.id);
            assertUndefined(record.doc.sortKey);

            engine.close();
            database.close();
        });

        it('preserves sort metadata through a Collection get and update round trip', async () => {
            const database = new DatabaseSync(':memory:');
            const engine = new DocumentStoreEngine({ logger: makeLogger(), database });
            const store = new DocumentStore();
            store.initialize({
                engine,
                indexes: [],
                cursorSigningSecret: 'document-store-engine-test-secret',
            });
            const notes = new NoteCollection({ db: store });

            await notes.create({}, {
                id: 'n1',
                sortKey: 'rank:1',
                title: 'Before',
            });
            const loaded = await notes.get({}, 'n1');
            loaded.set('title', 'After');
            const updated = await notes.update({}, loaded);

            assertEqual('rank:1', loaded.sortKey);
            assertUndefined(loaded.get('sortKey'));
            assertUndefined(loaded.toObject().sortKey);
            assertEqual('rank:1', loaded.toObject().meta.sortKey);
            assertEqual('rank:1', updated.sortKey);
            assertUndefined(updated.get('sortKey'));

            const row = database
                .prepare('SELECT sort_key, doc FROM documents WHERE type = ? AND id = ?')
                .get('Note', 'n1');
            const documentPayload = JSON.parse(row.doc);
            assertEqual('rank:1', row.sort_key);
            assertEqual('After', documentPayload.title);
            assertUndefined(documentPayload.type);
            assertUndefined(documentPayload.id);
            assertUndefined(documentPayload.sortKey);

            engine.close();
            database.close();
        });
    });
});
