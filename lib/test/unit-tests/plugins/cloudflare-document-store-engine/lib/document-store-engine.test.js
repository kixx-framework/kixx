import { DatabaseSync } from 'node:sqlite';

import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import DocumentStoreEngine from '../../../../../plugins/cloudflare-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../../kixx/logger/logger.js';
import { documentStoreEngineConformance } from '../../../kixx/document-store/document-store-engine-conformance.js';


// Minimal D1 binding double over node:sqlite. Implements only the surface the
// engine uses: prepare(), bind(), run(), and first(). SQL is compiled lazily in
// run()/first() so errors surface from the awaited call, as they do in D1.
class D1DatabaseDouble {

    prepareCount = 0;

    #database = null;

    constructor(database) {
        this.#database = database;
    }

    prepare(sql) {
        this.prepareCount += 1;
        return new D1StatementDouble(this.#database, sql, []);
    }
}

class D1StatementDouble {

    #database = null;
    #sql = null;
    #params = null;

    constructor(database, sql, params) {
        this.#database = database;
        this.#sql = sql;
        this.#params = params;
    }

    // D1 returns a new bound statement rather than mutating this one.
    bind(...params) {
        return new D1StatementDouble(this.#database, this.#sql, params);
    }

    async run() {
        const stmt = this.#database.prepare(this.#sql);

        // Row-returning statements (SELECT, PRAGMA, RETURNING) report columns.
        if (stmt.columns().length > 0) {
            return { success: true, results: stmt.all(...this.#params), meta: { changes: 0 } };
        }

        const info = stmt.run(...this.#params);
        return { success: true, results: [], meta: { changes: info.changes } };
    }

    async first() {
        return this.#database.prepare(this.#sql).get(...this.#params) ?? null;
    }
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeFixture(options) {
    const { database: suppliedDatabase, indexDefinitions = [] } = options ?? {};
    const database = suppliedDatabase ?? new DatabaseSync(':memory:');
    const d1 = new D1DatabaseDouble(database);
    const engine = new DocumentStoreEngine({ logger: makeLogger() });

    if (indexDefinitions !== null) {
        engine.setIndexDefinitions(indexDefinitions);
    }

    return {
        engine,
        context: { logger: makeLogger(), env: { DOCUMENT_STORE: d1 }, config: {} },
        database,
        d1,
        close() {
            engine.close();
            database.close();
        },
    };
}

// Conformance factory: the suite never sees the D1 double directly.
async function makeConformanceEngine(options) {
    const { engine, context, database, close } = makeFixture(options);
    return { engine, context, database, close };
}

describe('Cloudflare DocumentStoreEngine', ({ describe }) => {

    describe('D1 double smoke test', ({ it }) => {
        it('round-trips a document through put and get', async () => {
            const { engine, context, close } = makeFixture();
            try {
                const stored = await engine.put(context, {
                    type: 'Note',
                    id: 'n1',
                    sortKey: 'rank:1',
                    title: 'Hello',
                });
                const loaded = await engine.get(context, 'Note', 'n1');

                assertEqual(1, stored.version);
                assertEqual('n1', loaded.id);
                assertEqual('rank:1', loaded.sortKey);
                assertEqual(1, loaded.version);
                assertEqual(stored.createdAt, loaded.createdAt);
                assertEqual('Hello', loaded.doc.title);
                assertEqual(null, await engine.get(context, 'Note', 'missing'));
            } finally {
                close();
            }
        });
    });

    describe('scan()', ({ it }) => {
        it('rejects an unknown orderBy before any D1 call', async () => {
            const { engine, context, d1, close } = makeFixture();
            try {
                let caught = null;
                try {
                    await engine.scan(context, 'Note', { orderBy: 'updatedAt' });
                } catch (error) {
                    caught = error;
                }

                assert(caught, 'expected a rejection');
                assertEqual('AssertionError', caught.name);
                assertMatches('options.orderBy must be "sortKey" or "createdAt"', caught.message);
                assertEqual(0, d1.prepareCount);
            } finally {
                close();
            }
        });
    });

    documentStoreEngineConformance(describe, makeConformanceEngine);
});
