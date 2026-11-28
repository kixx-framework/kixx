import { observe } from '../../../lib/platform-observation.js';


// One table for every check. A check's rows carry the id of its request,
// and it removes what it wrote.
const CREATE_TABLE = 'CREATE TABLE IF NOT EXISTS platform_checks (id TEXT NOT NULL, body BLOB)';

// The sizes the row-limit checks try, in bytes. Cloudflare's limits page
// gives 8 MB for a string, BLOB, or table row, and doesn't say whether that
// is 8,000,000 or 8,388,608 bytes
// (https://developers.cloudflare.com/durable-objects/platform/limits/, read
// 2026-11-27). The fake keeps 2,000,000 (S06 OP3).
const BLOB_SIZES = Object.freeze({
    'sql-blob-2000001-bytes': 2000001,
    'sql-blob-4194304-bytes': 4194304,
    'sql-blob-8000000-bytes': 8000000,
    'sql-blob-8388609-bytes': 8388609,
});


/**
 * The behavior of the test-only Durable Object: the integration suite's
 * `sql.exec` platform checks, each run against the object's own storage.
 * The shell beside this file binds it to the Workers runtime; a unit test
 * hands it the fake storage in test/fakes/.
 *
 * A check reports what happened. It never asserts: the caller compares the
 * observation with lib/platform-expectations.js.
 */
export default class IntegrationProbeSqlStoreCore {

    #storage;
    #blobSizes;

    /**
     * @param {Object} options
     * @param {Object} options.ctx - Durable Object state: `ctx.storage` is used
     * @param {Object<string, number>} [options.blobSizes] - The size each row-limit check tries, by check name. Only a unit test passes it, to follow the path a looser platform takes.
     */
    constructor({ ctx, blobSizes = BLOB_SIZES }) {
        this.#storage = ctx.storage;
        this.#blobSizes = blobSizes;
    }

    /** The names of the checks this object runs. */
    static get checkNames() {
        return [
            'sql-too-few-bindings',
            'sql-unsupported-binding-type',
            ...Object.keys(BLOB_SIZES),
            'sql-transaction-rollback',
        ];
    }

    /**
     * Runs one check.
     *
     * @param {string} name - One of checkNames
     * @param {string} id - Unique to the request; names the rows the check writes
     * @returns {Promise<Object>} The observation: see lib/platform-observation.js
     * @throws {Error} When the name is not a check's
     */
    async runCheck(name, id) {
        const { sql } = this.#storage;

        sql.exec(CREATE_TABLE);

        if (name === 'sql-too-few-bindings') {
            // Two placeholders, one binding. The documentation doesn't say
            // what the platform does
            // (https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/,
            // read 2026-11-27). node:sqlite, under the fake, binds NULL.
            return observe(() => sql.exec('SELECT ? AS first, ? AS second', 'one').toArray()[0]);
        }

        if (name === 'sql-unsupported-binding-type') {
            // A boolean. The same page gives the bindings as `any[]` and
            // names no accepted type.
            return observe(() => sql.exec('SELECT ? AS value', true).toArray()[0]);
        }

        if (Object.hasOwn(this.#blobSizes, name)) {
            return this.#insertBlob(id, this.#blobSizes[name]);
        }

        if (name === 'sql-transaction-rollback') {
            return this.#rollBack(id);
        }

        throw new Error(`Unknown platform check: ${ name }`);
    }

    // One row holding a BLOB of the size. The row is removed again when the
    // platform took it.
    #insertBlob(id, size) {
        const { sql } = this.#storage;

        return observe(() => {
            sql.exec('INSERT INTO platform_checks (id, body) VALUES (?, ?)', id, new Uint8Array(size));

            const [ row ] = sql.exec('SELECT length(body) AS storedBytes FROM platform_checks WHERE id = ?', id).toArray();

            sql.exec('DELETE FROM platform_checks WHERE id = ?', id);

            return row;
        });
    }

    // Documented: "If callback() throws an exception, the transaction will
    // be rolled back" (the SQLite storage API page, read 2026-11-27).
    #rollBack(id) {
        const storage = this.#storage;

        return observe(() => {
            let thrown = null;

            try {
                storage.transactionSync(() => {
                    storage.sql.exec('INSERT INTO platform_checks (id, body) VALUES (?, ?)', id, null);
                    throw new Error('rolled back on purpose');
                });
            } catch (error) {
                thrown = error.message;
            }

            const [ row ] = storage.sql.exec('SELECT COUNT(*) AS rowsAfterRollback FROM platform_checks WHERE id = ?', id).toArray();

            // Nothing to remove when the platform rolled back.
            storage.sql.exec('DELETE FROM platform_checks WHERE id = ?', id);

            return { thrown, rowsAfterRollback: row.rowsAfterRollback };
        });
    }
}
