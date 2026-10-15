import { DatabaseSync } from 'node:sqlite';

import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import DocumentStore from '../../../../kixx/document-store/document-store.js';


/**
 * @typedef {Object} EngineFixture
 * @property {Object} engine - The DocumentStoreEngine under test
 * @property {Object} context - Execution context with a `logger`, accepted by every engine method
 * @property {import('node:sqlite').DatabaseSync} database - The `node:sqlite` handle beneath the engine
 * @property {function(): void} close - Releases the engine and the database
 */

/**
 * @callback MakeEngine
 * @param {Object} [options]
 * @param {import('node:sqlite').DatabaseSync} [options.database] - Pre-opened database to build the
 *   engine over, so a test can seed a legacy schema first. The factory opens `':memory:'` when omitted.
 * @param {Object[]|null} [options.indexDefinitions=[]] - Passed to `engine.setIndexDefinitions()`.
 *   `null` leaves the engine unconfigured so a DocumentStore facade can configure it.
 * @returns {Promise<EngineFixture>}
 */

/**
 * The shared DocumentStoreEngine contract suite for `created_at` scans, run
 * against every engine adapter.
 *
 * Covers only the `orderBy` scan contract and the `idx_type_created_at`
 * default index. Existing engine behavior stays in each adapter's own test
 * file. Every adapter here is backed by `node:sqlite` (the Cloudflare engine
 * through a D1-shaped double), so the factory exposes the raw database for
 * schema inspection and for pinning `created_at`, which the engine assigns.
 *
 * Call it from inside an adapter's top-level `describe` callback, passing that
 * callback's nested `describe` handle.
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block
 * @param {MakeEngine} makeEngine - Builds the engine under test
 */
export function documentStoreEngineConformance(describe, makeEngine) {

    const T1 = '2026-01-01T00:00:00.001Z';
    const T2 = '2026-01-01T00:00:00.002Z';
    const T3 = '2026-01-01T00:00:00.003Z';
    const T4 = '2026-01-01T00:00:00.004Z';

    // Puts each row, then pins created_at directly, since the engine assigns it.
    async function seed(fixture, rows) {
        const { engine, context, database } = fixture;

        for (const row of rows) {
            const doc = { type: 'Note', id: row.id, title: row.id };
            if (row.sortKey !== undefined) {
                doc.sortKey = row.sortKey;
            }
            await engine.put(context, doc);
        }

        const update = database.prepare('UPDATE documents SET created_at = ? WHERE type = ? AND id = ?');
        for (const row of rows) {
            if (row.createdAt) {
                update.run(row.createdAt, 'Note', row.id);
            }
        }
    }

    async function scanIds(fixture, options) {
        const { records } = await fixture.engine.scan(fixture.context, 'Note', options);
        return records.map(({ id }) => id);
    }

    // Walks every page through engine continuations.
    async function scanAllIds(fixture, options) {
        const ids = [];
        let cursor;

        for (let page = 0; page < 20; page += 1) {
            const result = await fixture.engine.scan(fixture.context, 'Note', Object.assign({}, options, { cursor }));
            for (const record of result.records) {
                ids.push(record.id);
            }
            if (result.cursor === null) {
                return ids;
            }
            cursor = result.cursor;
        }

        throw new Error('scan did not terminate within 20 pages');
    }

    function indexNames(database) {
        return database.prepare('PRAGMA index_list(documents)').all().map(({ name }) => name);
    }

    async function catchRejection(promise) {
        try {
            await promise;
        } catch (error) {
            return error;
        }
        return null;
    }

    describe('created_at scan conformance', ({ describe }) => {

        describe('default indexes', ({ it }) => {
            it('creates idx_type_sort_key and idx_type_created_at on first use', async () => {
                const fixture = await makeEngine();
                try {
                    await seed(fixture, [{ id: 'a' }]);

                    const names = indexNames(fixture.database);
                    assert(names.includes('idx_type_sort_key'), 'idx_type_sort_key exists');
                    assert(names.includes('idx_type_created_at'), 'idx_type_created_at exists');
                } finally {
                    fixture.close();
                }
            });

            it('adds idx_type_created_at to a legacy schema without disturbing rows', async () => {
                const database = new DatabaseSync(':memory:');

                database.exec(`
                    CREATE TABLE documents (
                        type       TEXT    NOT NULL,
                        id         TEXT    NOT NULL,
                        sort_key   TEXT,
                        version    INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT    NOT NULL,
                        updated_at TEXT    NOT NULL,
                        doc        TEXT    NOT NULL,
                        PRIMARY KEY (type, id)
                    )
                `);
                database.exec('CREATE INDEX idx_type_sort_key ON documents (type, sort_key)');
                database
                    .prepare('INSERT INTO documents (type, id, sort_key, version, created_at, updated_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run('Note', 'legacy', 'k1', 3, T1, T2, JSON.stringify({ title: 'Legacy' }));

                assert(!indexNames(database).includes('idx_type_created_at'), 'legacy schema lacks the new index');

                const fixture = await makeEngine({ database });
                try {
                    const record = await fixture.engine.get(fixture.context, 'Note', 'legacy');

                    assert(indexNames(database).includes('idx_type_created_at'), 'idx_type_created_at exists');
                    assertEqual('legacy', record.id);
                    assertEqual('k1', record.sortKey);
                    assertEqual(3, record.version);
                    assertEqual(T1, record.createdAt);
                    assertEqual(T2, record.updatedAt);
                    assertEqual('Legacy', record.doc.title);

                    // A second prepare is idempotent.
                    await fixture.engine.prepareDatabase(fixture.context);
                    assert(indexNames(database).includes('idx_type_created_at'), 'index survives a second prepare');
                } finally {
                    fixture.close();
                }
            });
        });

        describe('orderBy createdAt', ({ it }) => {
            it('orders by created_at, not sort_key, in both directions', async () => {
                const fixture = await makeEngine();
                try {
                    await seed(fixture, [
                        { id: 'a', sortKey: 's3', createdAt: T1 },
                        { id: 'b', sortKey: 's2', createdAt: T2 },
                        { id: 'c', sortKey: 's1', createdAt: T3 },
                    ]);

                    const ascending = await fixture.engine.scan(fixture.context, 'Note', { orderBy: 'createdAt' });
                    assertEqual('a,b,c', ascending.records.map(({ id }) => id).join(','));
                    assertEqual('s3,s2,s1', ascending.records.map(({ sortKey }) => sortKey).join(','));
                    assertEqual([ T1, T2, T3 ].join(','), ascending.records.map(({ createdAt }) => createdAt).join(','));
                    assertEqual(null, ascending.cursor);

                    const descending = await scanIds(fixture, { orderBy: 'createdAt', descending: true });
                    assertEqual('c,b,a', descending.join(','));

                    // sort_key order is the reverse, which proves the column switch.
                    assertEqual('c,b,a', (await scanIds(fixture, { orderBy: 'sortKey' })).join(','));
                } finally {
                    fixture.close();
                }
            });

            it('applies equalTo and range bounds to created_at', async () => {
                const fixture = await makeEngine();
                try {
                    await seed(fixture, [
                        { id: 'r1', sortKey: 'z', createdAt: T1 },
                        { id: 'r2', sortKey: 'y', createdAt: T2 },
                        { id: 'r3', sortKey: 'x', createdAt: T3 },
                        { id: 'r4', sortKey: 'w', createdAt: T4 },
                    ]);

                    const cases = [
                        [ { equalTo: T2 }, 'r2' ],
                        [ { greaterThan: T2 }, 'r3,r4' ],
                        [ { greaterThanOrEqualTo: T2 }, 'r2,r3,r4' ],
                        [ { lessThan: T3 }, 'r1,r2' ],
                        [ { lessThanOrEqualTo: T3 }, 'r1,r2,r3' ],
                        [ { greaterThanOrEqualTo: T2, lessThan: T4 }, 'r2,r3' ],
                        [ { greaterThan: T1, lessThanOrEqualTo: T3 }, 'r2,r3' ],
                    ];

                    for (const [ range, expected ] of cases) {
                        const ids = await scanIds(fixture, Object.assign({ orderBy: 'createdAt' }, range));
                        assertEqual(expected, ids.join(','), JSON.stringify(range));
                    }
                } finally {
                    fixture.close();
                }
            });

            it('pages through tied created_at values by (created_at, id)', async () => {
                const fixture = await makeEngine();
                try {
                    await seed(fixture, [
                        { id: 'p4', sortKey: 'a', createdAt: T2 },
                        { id: 'p1', sortKey: 'e', createdAt: T1 },
                        { id: 'p5', sortKey: 'b', createdAt: T3 },
                        { id: 'p2', sortKey: 'd', createdAt: T2 },
                        { id: 'p3', sortKey: 'c', createdAt: T2 },
                    ]);

                    const ascending = await scanAllIds(fixture, { orderBy: 'createdAt', limit: 2 });
                    assertEqual('p1,p2,p3,p4,p5', ascending.join(','));

                    const descending = await scanAllIds(fixture, { orderBy: 'createdAt', descending: true, limit: 2 });
                    assertEqual('p5,p4,p3,p2,p1', descending.join(','));
                } finally {
                    fixture.close();
                }
            });
        });

        describe('default ordering', ({ it }) => {
            it('orders by sort_key when orderBy is omitted, with NULL sort keys handled as before', async () => {
                const fixture = await makeEngine();
                try {
                    // created_at runs opposite to sort_key so a wrong column would show.
                    await seed(fixture, [
                        { id: 'b', sortKey: 'k2', createdAt: T1 },
                        { id: 'n2', createdAt: T2 },
                        { id: 'a', sortKey: 'k1', createdAt: T3 },
                        { id: 'c', sortKey: 'k3', createdAt: T1 },
                        { id: 'n1', createdAt: T4 },
                    ]);

                    const omitted = await scanIds(fixture, {});
                    assertEqual('n1,n2,a,b,c', omitted.join(','));
                    assertEqual(omitted.join(','), (await scanIds(fixture, { orderBy: 'sortKey' })).join(','));

                    assertEqual('c,b,a,n2,n1', (await scanIds(fixture, { descending: true })).join(','));

                    assertEqual('n1,n2,a,b,c', (await scanAllIds(fixture, { limit: 2 })).join(','));
                    assertEqual('c,b,a,n2,n1', (await scanAllIds(fixture, { descending: true, limit: 2 })).join(','));
                } finally {
                    fixture.close();
                }
            });
        });

        describe('engine defense', ({ it }) => {
            it('rejects unknown orderBy values without touching the table', async () => {
                const fixture = await makeEngine();
                try {
                    await seed(fixture, [{ id: 'a', sortKey: 'k1' }]);

                    for (const orderBy of [ 'updated_at', 'created_at; DROP TABLE documents' ]) {
                        const error = await catchRejection(fixture.engine.scan(fixture.context, 'Note', { orderBy }));

                        assert(error, `expected rejection for ${ orderBy }`);
                        assertEqual('AssertionError', error.name);
                        assertMatches('options.orderBy must be "sortKey" or "createdAt"', error.message);
                    }

                    const table = fixture.database
                        .prepare('SELECT name FROM sqlite_schema WHERE type = ? AND name = ?')
                        .get('table', 'documents');
                    assertEqual('documents', table.name);
                    assertEqual('a', (await scanIds(fixture, {})).join(','));
                } finally {
                    fixture.close();
                }
            });
        });

        describe('DocumentStore facade', ({ it }) => {
            it('pages tied rows by createdAt with signed public cursors', async () => {
                const fixture = await makeEngine({ indexDefinitions: null });
                try {
                    const store = new DocumentStore({ logger: fixture.context.logger });
                    store.initialize({
                        engine: fixture.engine,
                        indexes: [],
                        cursorSigningSecret: 'document-store-engine-conformance-secret',
                    });

                    await seed(fixture, [
                        { id: 'p3', sortKey: 'a', createdAt: T2 },
                        { id: 'p1', sortKey: 'd', createdAt: T1 },
                        { id: 'p4', sortKey: 'b', createdAt: T3 },
                        { id: 'p2', sortKey: 'c', createdAt: T2 },
                    ]);

                    for (const descending of [ false, true ]) {
                        const ids = [];
                        let cursor;
                        let pages = 0;

                        do {
                            const result = await store.scan(fixture.context, 'Note', {
                                orderBy: 'createdAt',
                                descending,
                                limit: 2,
                                cursor,
                            });
                            ids.push(...result.records.map(({ id }) => id));
                            cursor = result.cursor;
                            pages += 1;

                            if (cursor !== null) {
                                assertEqual('string', typeof cursor);
                            }
                        } while (cursor !== null && pages < 20);

                        const expected = descending ? 'p4,p3,p2,p1' : 'p1,p2,p3,p4';
                        assertEqual(expected, ids.join(','));
                        assertEqual(2, pages);
                    }
                } finally {
                    fixture.close();
                }
            });
        });
    });
}
