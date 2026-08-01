import { DatabaseSync } from 'node:sqlite';

import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import DocumentStoreEngine from '../../../../../src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../../src/kixx/logger/logger.js';


const openDatabases = [];

/**
 * Minimal D1 binding backed by node:sqlite.
 *
 * D1 is an HTTP facade over SQLite, so a real SQLite connection reproduces the
 * behavior this engine depends on: PRAGMA result shape, the CREATE TABLE text
 * SQLite stores in sqlite_master, generated-column semantics, and DDL inside a
 * transaction. It cannot reproduce Cloudflare's API layer, so these tests prove
 * the SQL and the migration logic are correct without proving that the D1 service
 * accepts every statement shape.
 */
class MockD1Database {

    constructor(database) {
        this.database = database;
        // Call counts stand in for network round trips, which is what prepareDatabase()
        // is structured to minimize on a cold Worker isolate.
        this.calls = { run: 0, first: 0, batch: 0 };
    }

    prepare(sql) {
        return new MockD1PreparedStatement(this, sql, []);
    }

    async batch(statements) {
        this.calls.batch += 1;

        // D1 executes a batch in order inside an implicit transaction. Reproducing the
        // transaction is the point: it is what makes a failed migration roll back as a
        // unit instead of leaving a column without its index.
        this.database.exec('BEGIN');
        try {
            const results = [];
            for (const statement of statements) {
                results.push(await statement.run());
            }
            this.database.exec('COMMIT');
            return results;
        } catch (error) {
            this.database.exec('ROLLBACK');
            throw error;
        }
    }

    execute(sql, params) {
        const statement = this.database.prepare(sql);
        // all() returns rows for row-returning statements and [] for the rest, so a
        // single path serves SELECT, PRAGMA, DDL, and INSERT ... RETURNING alike.
        const results = statement.all(...params);
        const { n } = this.database.prepare('SELECT changes() AS n').get();
        return { results, changes: n };
    }

    resetCalls() {
        this.calls = { run: 0, first: 0, batch: 0 };
    }
}

class MockD1PreparedStatement {

    #db;
    #sql;
    #params;

    constructor(db, sql, params) {
        this.#db = db;
        this.#sql = sql;
        this.#params = params;
    }

    bind(...params) {
        return new MockD1PreparedStatement(this.#db, this.#sql, params);
    }

    async run() {
        this.#db.calls.run += 1;
        const { results, changes } = this.#db.execute(this.#sql, this.#params);
        return { success: true, results, meta: { changes } };
    }

    async first() {
        this.#db.calls.first += 1;
        const { results } = this.#db.execute(this.#sql, this.#params);
        return results.length > 0 ? results[0] : null;
    }
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeDatabase() {
    const database = new DatabaseSync(':memory:');
    openDatabases.push(database);
    return { database, db: new MockD1Database(database) };
}

function makeContext(db) {
    return { config: {}, env: { DOCUMENT_STORE: db } };
}

/**
 * Builds an engine as a freshly started Worker isolate would: a new instance with
 * no memory of any previous migration, pointed at an existing database.
 */
function makeEngine(indexDefinitions) {
    const engine = new DocumentStoreEngine({ logger: makeLogger() });
    engine.setIndexDefinitions(indexDefinitions);
    return engine;
}

function getKeyColumns(database) {
    return database
        .prepare('PRAGMA table_xinfo(documents)')
        .all()
        .map(({ name }) => name)
        .filter((name) => name.startsWith('key_'))
        .sort();
}

function getIndexNames(database) {
    return database
        .prepare('PRAGMA index_list(documents)')
        .all()
        .map(({ name }) => name)
        .sort();
}

function isIndexUnique(database, indexName) {
    const row = database
        .prepare('PRAGMA index_list(documents)')
        .all()
        .find(({ name }) => name === indexName);
    return row ? row.unique === 1 : null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('Cloudflare DocumentStoreEngine', ({ after, describe }) => {

    after(() => {
        for (const database of openDatabases) {
            database.close();
        }
    });

    describe('prepareDatabase() on a fresh database', ({ it }) => {
        it('creates the documents table and the default sort key index', async () => {
            const { database, db } = makeDatabase();
            const engine = makeEngine([]);

            await engine.prepareDatabase(makeContext(db));

            const columns = database
                .prepare('PRAGMA table_xinfo(documents)')
                .all()
                .map(({ name }) => name);

            assertEqual(
                'created_at,doc,id,sort_key,type,updated_at,version',
                columns.sort().join(','),
            );
            assert(getIndexNames(database).includes('idx_type_sort_key'));
        });

        it('creates a generated column and index for every definition', async () => {
            const { database, db } = makeDatabase();
            const engine = makeEngine([
                { name: 'by_title', jsonPath: '$.title' },
                { name: 'by_email', jsonPath: '$.email', unique: true },
            ]);

            await engine.prepareDatabase(makeContext(db));

            assertEqual('key_by_email,key_by_title', getKeyColumns(database).join(','));
            assert(getIndexNames(database).includes('idx_type_custom_key_by_title'));
            assertEqual(true, isIndexUnique(database, 'idx_type_custom_key_by_email'));
            assertEqual(false, isIndexUnique(database, 'idx_type_custom_key_by_title'));
        });

        it('populates the generated column from stored JSON so queries match', async () => {
            const { db } = makeDatabase();
            const context = makeContext(db);
            const engine = makeEngine([ { name: 'by_title', jsonPath: '$.title' } ]);

            await engine.put(context, { type: 'Note', id: 'n1', title: 'Alpha' });
            await engine.put(context, { type: 'Note', id: 'n2', title: 'Beta' });
            const page = await engine.query(context, 'Note', {
                index: 'by_title',
                equalTo: 'Beta',
            });

            assertEqual(1, page.records.length);
            assertEqual('n2', page.records[0].id);
        });
    });

    describe('prepareDatabase() when the schema already matches', ({ it }) => {
        it('issues no DDL and reads the schema exactly once', async () => {
            const { db } = makeDatabase();
            const context = makeContext(db);
            const indexes = [ { name: 'by_title', jsonPath: '$.title' } ];

            await makeEngine(indexes).prepareDatabase(context);
            db.resetCalls();

            // A second isolate starting against the already-migrated database.
            await makeEngine(indexes).prepareDatabase(context);

            // The two PRAGMAs go through run() and the sqlite_master read through
            // first(). All three are issued concurrently, so this is one round trip
            // of latency, and no batch() means no DDL was emitted at all.
            assertEqual(0, db.calls.batch);
            assertEqual(2, db.calls.run);
            assertEqual(1, db.calls.first);
        });

        it('is idempotent across repeated migrations', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);
            const indexes = [
                { name: 'by_title', jsonPath: '$.title' },
                { name: 'by_email', jsonPath: '$.email', unique: true },
            ];

            await makeEngine(indexes).prepareDatabase(context);
            await makeEngine(indexes).prepareDatabase(context);
            await makeEngine(indexes).prepareDatabase(context);

            assertEqual('key_by_email,key_by_title', getKeyColumns(database).join(','));
            assertEqual(true, isIndexUnique(database, 'idx_type_custom_key_by_email'));
        });
    });

    describe('prepareDatabase() reconciliation', ({ it }) => {
        it('rebuilds the generated column when jsonPath changes', async () => {
            const { db } = makeDatabase();
            const context = makeContext(db);

            const before = makeEngine([ { name: 'by_label', jsonPath: '$.title' } ]);
            await before.put(context, {
                type: 'Note',
                id: 'n1',
                title: 'Alpha',
                name: 'Zulu',
            });

            // A redeploy which repoints the same index at a different field. The column
            // expression cannot be altered in place, so the migration has to drop and
            // rebuild it. Recovering the old path depends on matching the CREATE TABLE
            // text SQLite stored, which is what this assertion really exercises.
            const afterEngine = makeEngine([ { name: 'by_label', jsonPath: '$.name' } ]);
            await afterEngine.prepareDatabase(context);

            const matched = await afterEngine.query(context, 'Note', {
                index: 'by_label',
                equalTo: 'Zulu',
            });
            const stale = await afterEngine.query(context, 'Note', {
                index: 'by_label',
                equalTo: 'Alpha',
            });

            assertEqual(1, matched.records.length);
            assertEqual('n1', matched.records[0].id);
            assertEqual(0, stale.records.length);
        });

        it('leaves the column alone when jsonPath is unchanged', async () => {
            const { db } = makeDatabase();
            const context = makeContext(db);
            const indexes = [ { name: 'by_title', jsonPath: '$.title' } ];

            await makeEngine(indexes).prepareDatabase(context);
            db.resetCalls();
            await makeEngine(indexes).prepareDatabase(context);

            // A jsonPath the migration failed to recognize would look like a change and
            // trigger a needless drop-and-rebuild of the column on every cold start.
            assertEqual(0, db.calls.batch);
        });

        it('round trips a jsonPath containing a single quote', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);
            const indexes = [ { name: 'by_odd', jsonPath: '$."odd\'name"' } ];

            const engine = makeEngine(indexes);
            await engine.put(context, { type: 'Note', id: 'n1', 'odd\'name': 'Quoted' });
            const page = await engine.query(context, 'Note', {
                index: 'by_odd',
                equalTo: 'Quoted',
            });

            assertEqual(1, page.records.length);

            // The quote must survive the SQL literal escaping in both directions, or the
            // next migration reads back a different path and rebuilds the column forever.
            db.resetCalls();
            await makeEngine(indexes).prepareDatabase(context);

            assertEqual(0, db.calls.batch);
            assertEqual('key_by_odd', getKeyColumns(database).join(','));
        });

        it('drops the column and index when a definition is removed', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);

            await makeEngine([
                { name: 'by_title', jsonPath: '$.title' },
                { name: 'by_email', jsonPath: '$.email' },
            ]).prepareDatabase(context);

            await makeEngine([
                { name: 'by_title', jsonPath: '$.title' },
            ]).prepareDatabase(context);

            assertEqual('key_by_title', getKeyColumns(database).join(','));
            assertEqual(false, getIndexNames(database).includes('idx_type_custom_key_by_email'));
        });

        it('recreates the default sort key index when it is missing', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);

            await makeEngine([]).prepareDatabase(context);
            // Simulates a migration interrupted between CREATE TABLE and CREATE INDEX.
            database.exec('DROP INDEX idx_type_sort_key');

            await makeEngine([]).prepareDatabase(context);

            assert(getIndexNames(database).includes('idx_type_sort_key'));
        });

        it('recreates the index when a definition switches to unique', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);

            await makeEngine([
                { name: 'by_email', jsonPath: '$.email' },
            ]).prepareDatabase(context);
            assertEqual(false, isIndexUnique(database, 'idx_type_custom_key_by_email'));

            await makeEngine([
                { name: 'by_email', jsonPath: '$.email', unique: true },
            ]).prepareDatabase(context);

            assertEqual(true, isIndexUnique(database, 'idx_type_custom_key_by_email'));
            // The column is not rebuilt for a uniqueness change; only the index is.
            assertEqual('key_by_email', getKeyColumns(database).join(','));
        });
    });

    describe('unique secondary indexes', ({ it }) => {
        it('translates a SQLite unique constraint failure', async () => {
            const { db } = makeDatabase();
            const context = makeContext(db);
            const engine = makeEngine([
                { name: 'by_email', jsonPath: '$.email', unique: true },
            ]);

            await engine.put(context, { type: 'Note', id: 'n1', email: 'a@example.com' });
            const caught = await catchAsyncError(() => {
                return engine.put(context, { type: 'Note', id: 'n2', email: 'a@example.com' });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('DocumentUniqueIndexViolationError', caught.name);
            assertEqual('by_email', caught.indexName);
        });

        it('allows the same value under a different document type', async () => {
            const { db } = makeDatabase();
            const context = makeContext(db);
            const engine = makeEngine([
                { name: 'by_email', jsonPath: '$.email', unique: true },
            ]);

            await engine.put(context, { type: 'Note', id: 'n1', email: 'a@example.com' });
            await engine.put(context, { type: 'Page', id: 'p1', email: 'a@example.com' });

            const note = await engine.get(context, 'Note', 'n1');
            const page = await engine.get(context, 'Page', 'p1');

            assertEqual('a@example.com', note.doc.email);
            assertEqual('a@example.com', page.doc.email);
        });
    });

    describe('prepareDatabase() failure handling', ({ it }) => {
        it('falls back to create-then-read when the first introspection fails', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);
            let failures = 0;

            // A database which has never been migrated is the case where introspection is
            // least trustworthy, so the first read is allowed to fail without being fatal.
            const execute = db.execute.bind(db);
            db.execute = (sql, params) => {
                if (sql.includes('table_xinfo') && failures === 0) {
                    failures += 1;
                    throw new Error('introspection unavailable');
                }
                return execute(sql, params);
            };

            await makeEngine([ { name: 'by_title', jsonPath: '$.title' } ])
                .prepareDatabase(context);

            assertEqual(1, failures);
            assertEqual('key_by_title', getKeyColumns(database).join(','));
        });

        it('rebuilds a key column which is not a generated column', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);

            await makeEngine([]).prepareDatabase(context);
            // A plain column occupying the name the migration wants. There is no
            // json_extract() expression to recover, so it reads as a changed path and is
            // replaced rather than left in place silently extracting nothing.
            database.exec('ALTER TABLE documents ADD COLUMN key_by_title TEXT');

            const engine = makeEngine([ { name: 'by_title', jsonPath: '$.title' } ]);
            await engine.put(context, { type: 'Note', id: 'n1', title: 'Alpha' });
            const page = await engine.query(context, 'Note', {
                index: 'by_title',
                equalTo: 'Alpha',
            });

            assertEqual(1, page.records.length);
        });

        it('rolls back the whole migration when one statement fails', async () => {
            const { database, db } = makeDatabase();
            const context = makeContext(db);

            await makeEngine([]).prepareDatabase(context);

            const execute = db.execute.bind(db);
            db.execute = (sql, params) => {
                // Fail the CREATE INDEX so the ALTER TABLE ahead of it has already been
                // applied inside the transaction by the time the batch aborts.
                if (sql.includes('idx_type_custom_key_by_title')) {
                    throw new Error('D1 statement failed');
                }
                return execute(sql, params);
            };

            const caught = await catchAsyncError(() => {
                return makeEngine([ { name: 'by_title', jsonPath: '$.title' } ])
                    .prepareDatabase(context);
            });
            db.execute = execute;

            assert(caught, 'expected an error to be thrown');
            assertMatches('Unable to reconcile secondary indexes', caught.message);
            assertEqual('D1 statement failed', caught.cause.message);
            // Without the transaction the column would survive without its index, which
            // is the half-migrated state a statement-at-a-time migration can leave behind.
            assertEqual('', getKeyColumns(database).join(','));
        });
    });
});
