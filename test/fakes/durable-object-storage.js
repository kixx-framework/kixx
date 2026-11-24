/**
 * A fake of SQLite-backed Durable Object storage (`ctx.storage`) for unit
 * tests, built on a `node:sqlite` database.
 *
 * Shared on purpose. Test helpers are normally local to one test file. A fake
 * of a platform service is an exception, because every test of code that runs
 * in a Durable Object must meet the same platform rules. Only test code
 * imports this module.
 *
 * What it models, from Cloudflare's documentation:
 *
 * - `sql.exec(query, ...bindings)` runs synchronously and returns a cursor
 *   with `next()`, `toArray()` (the remaining rows), `one()` (throws unless
 *   exactly one row remains), and iteration. Reading a cursor consumes it.
 * - Rows are plain objects whose values are `ArrayBuffer`, string, number, or
 *   `null`. A BLOB comes back as a standalone `ArrayBuffer`.
 * - An `ArrayBuffer` or a view binds as a BLOB (an empty view as an empty
 *   BLOB, not `NULL`), and `undefined` binds as `NULL`.
 * - `exec` can't run transaction statements: `BEGIN`, `COMMIT`, `END`,
 *   `ROLLBACK`, `SAVEPOINT`, or `RELEASE`. A leading SQL comment doesn't hide
 *   one.
 * - `transactionSync(callback)` commits when the callback returns and rolls
 *   back when it throws. A nested call rolls back only itself.
 * - Limits: 100 bindings per query, a 100 KB statement, and a 2 MB row,
 *   string, or BLOB. The statement limit is counted as 100,000 UTF-8 bytes.
 *   The row limit is counted as 2,000,000 bytes across one statement's string
 *   and BLOB bindings, and fails with an error starting `SQLITE_TOOBIG`.
 *
 * Where it is stricter than the platform:
 *
 * - The row limit. Cloudflare's limits page gives 8 MB for a string, BLOB, or
 *   table row, while its architecture guidance and D1's limits give 2 MB. The
 *   fake keeps 2 MB until the real limit is measured on Cloudflare. Code that
 *   passes at 2 MB also passes at 8 MB.
 * - A query holding more than one statement throws. The platform runs every
 *   statement, but `node:sqlite` silently drops all but the first. Anything
 *   after the first statement's semicolon counts, a trailing comment included.
 * - A query whose first statement is empty throws: one of only whitespace and
 *   comments, or one that starts with a semicolon. `node:sqlite` prepares an
 *   empty statement from such a query and then mishandles it: Node.js 24 can
 *   crash at a later garbage collection, and Deno 2.8 crashes at once. So the
 *   fake rejects the query before preparing it.
 * - `transactionSync` rolls back and throws `TypeError` when its callback
 *   returns a thenable. The platform commits. The fake fails so that an async
 *   callback is caught.
 * - A binding must be a string, number, `null`, `undefined`, `ArrayBuffer`, or
 *   view. Anything else throws `TypeError`. The documentation doesn't say what
 *   the platform does with other types, and `node:sqlite` binds some of them
 *   as `NULL` without an error.
 *
 * What it doesn't model:
 *
 * - `raw()`, `columnNames`, `rowsRead`, and `rowsWritten` on the cursor, and
 *   `sql.databaseSize`. They are left out.
 * - The key-value storage API, the async `storage.transaction()`, and alarms.
 * - The 10 GB limit per object and the limit of 100 columns per table.
 * - Lazy cursors. Rows are read eagerly when `exec` runs.
 * - A binding count that doesn't match the statement's placeholders.
 *   `node:sqlite` binds a missing one as `NULL`. The documentation doesn't say
 *   what the platform does.
 * - The platform's error messages. Apart from the `SQLITE_TOOBIG` prefix, the
 *   messages are the fake's own.
 *
 * Documentation, checked 2026-11-24:
 *
 * - https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
 * - https://developers.cloudflare.com/durable-objects/platform/limits/
 *
 * When a run on Cloudflare shows that this fake differs from the platform,
 * fix the fake and pin the difference with a unit test.
 */

import { DatabaseSync } from 'node:sqlite';


// The stricter of the two documented row, string, and BLOB limits.
const MAX_BOUND_BYTES = 2000000;

const MAX_BINDINGS = 100;

// The documented 100 KB, read as decimal kilobytes because that is stricter.
const MAX_STATEMENT_BYTES = 100000;

// A line comment, or a block comment that ends at its first close or at the
// end of the query. Used only to see what a query starts with. It also matches
// comment-like text inside a string literal, which is harmless there: no
// literal can come before a statement's first token.
const COMMENT_PATTERN = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

// Both are tested against a query with its comments already removed. Removing
// the comments first, as its own step, keeps a block comment from stretching
// over a real statement to reach a later semicolon.
const EMPTY_FIRST_STATEMENT_PATTERN = /^\s*(?:;|$)/;
const TRANSACTION_STATEMENT_PATTERN = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

const textEncoder = new TextEncoder();


/**
 * @typedef {Object} FakeSqlCursor
 * @property {function(): {done: boolean, value: (Object|undefined)}} next - The
 *   next row, as an iterator result
 * @property {function(): Object[]} toArray - The remaining rows
 * @property {function(): Object} one - The only remaining row; throws unless
 *   exactly one row remains
 */

/**
 * @typedef {Object} FakeDurableObjectStorage
 * @property {{exec: function(string, ...*): FakeSqlCursor}} sql - Runs one
 *   statement eagerly and returns an iterable cursor over its rows
 * @property {function(function(): *): *} transactionSync - Runs the callback
 *   in a transaction (a savepoint when nested) and returns its value
 * @property {function(): void} close - Closes the database
 */

/**
 * Creates an empty Durable Object storage, or reopens the one at `path`.
 *
 * Closing a file-backed storage and creating another at the same path models
 * a Durable Object restarting over its persisted data.
 * @param {Object} [options]
 * @param {string} [options.path=':memory:'] - Database file path. The default
 *   keeps the database in memory.
 * @returns {FakeDurableObjectStorage}
 */
export function createFakeDurableObjectStorage(options) {
    const {
        path = ':memory:',
    } = options ?? {};

    const database = new DatabaseSync(path);
    let depth = 0;

    const sql = {
        exec(query, ...bindings) {
            assertIsString(query);

            const withoutComments = query.replace(COMMENT_PATTERN, '');

            assertFirstStatementHoldsText(withoutComments);
            assertStatementLength(query);
            assertNotTransactionStatement(withoutComments);
            assertBindingCount(bindings);

            const values = bindings.map(toBindingValue);
            assertBindingSize(values);

            // Checked before the statement runs, so a rejected query changes
            // nothing.
            const statement = database.prepare(query);
            assertSingleStatement(query, statement);

            const rows = statement.all(...values).map(toPlainRow);
            return createCursor(rows);
        },
    };

    // Uses the database directly: the transaction statements it needs are the
    // ones exec() rejects.
    function transactionSync(callback) {
        const savepoint = `nested_${ depth }`;
        const isOuter = depth === 0;

        database.exec(isOuter ? 'BEGIN' : `SAVEPOINT ${ savepoint }`);
        depth += 1;

        let result;
        try {
            result = callback();
            if (typeof result?.then === 'function') {
                throw new TypeError('transactionSync() callback must not return a Promise');
            }
        } catch (error) {
            depth -= 1;
            database.exec(isOuter ? 'ROLLBACK' : `ROLLBACK TO ${ savepoint }; RELEASE ${ savepoint }`);
            throw error;
        }

        depth -= 1;
        database.exec(isOuter ? 'COMMIT' : `RELEASE ${ savepoint }`);
        return result;
    }

    return {
        sql,
        transactionSync,
        close() {
            database.close();
        },
    };
}


function assertIsString(query) {
    if (typeof query !== 'string') {
        throw new TypeError('the query must be a string');
    }
}

// Checked before prepare(), because node:sqlite mishandles the empty
// statement it prepares from a query whose first statement is empty (see the
// module comment).
function assertFirstStatementHoldsText(withoutComments) {
    if (EMPTY_FIRST_STATEMENT_PATTERN.test(withoutComments)) {
        throw new Error('the query does not contain a statement');
    }
}

function assertStatementLength(query) {
    const length = textEncoder.encode(query).length;

    if (length > MAX_STATEMENT_BYTES) {
        throw new Error(`statement is ${ length } bytes, over the ${ MAX_STATEMENT_BYTES } byte statement limit`);
    }
}

function assertNotTransactionStatement(withoutComments) {
    const match = TRANSACTION_STATEMENT_PATTERN.exec(withoutComments);

    if (match) {
        throw new Error(`sql.exec() cannot run the transaction statement ${ match[1].toUpperCase() }; use transactionSync()`);
    }
}

function assertBindingCount(bindings) {
    if (bindings.length > MAX_BINDINGS) {
        throw new Error(`too many SQL variables: ${ bindings.length } bindings, over the limit of ${ MAX_BINDINGS } per query`);
    }
}

function toBindingValue(value, index) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }

    // node:sqlite on Node.js binds an empty view over a zero-length buffer
    // (such as new TextEncoder().encode('')) as NULL; the platform binds an
    // empty BLOB.
    if (ArrayBuffer.isView(value)) {
        return value.byteLength === 0 ? new Uint8Array(0) : value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }

    // node:sqlite reads any other object in first position as a set of named
    // parameters. It would bind NULL and shift the remaining bindings, without
    // an error.
    throw new TypeError(`binding ${ index + 1 } must be a string, number, null, undefined, ArrayBuffer, or view`);
}

function assertBindingSize(values) {
    let total = 0;
    for (const value of values) {
        if (typeof value === 'string') {
            total += textEncoder.encode(value).length;
        } else if (ArrayBuffer.isView(value)) {
            total += value.byteLength;
        }
    }

    if (total > MAX_BOUND_BYTES) {
        throw new Error(`SQLITE_TOOBIG: bindings total ${ total } bytes, over the ${ MAX_BOUND_BYTES } byte row limit`);
    }
}

function assertSingleStatement(query, statement) {
    // sourceSQL holds only the first statement's text, so anything left over
    // is a statement node:sqlite would silently never run.
    if (query.slice(statement.sourceSQL.length).trim() !== '') {
        throw new Error('multi-statement queries are not modeled by this fake');
    }
}

function toPlainRow(row) {
    const plain = {};
    for (const [ key, value ] of Object.entries(row)) {
        // Copy out of node:sqlite's Uint8Array into a standalone ArrayBuffer,
        // which is what the platform returns.
        plain[key] = value instanceof Uint8Array ? value.slice().buffer : value;
    }
    return plain;
}

function createCursor(rows) {
    let index = 0;

    return {
        next() {
            if (index < rows.length) {
                const value = rows[index];
                index += 1;
                return { done: false, value };
            }
            return { done: true, value: undefined };
        },

        toArray() {
            const remaining = rows.slice(index);
            index = rows.length;
            return remaining;
        },

        one() {
            const remaining = this.toArray();
            if (remaining.length !== 1) {
                throw new Error(`Expected exactly one result from SQL query, but got ${ remaining.length === 0 ? 'no' : remaining.length } results.`);
            }
            return remaining[0];
        },

        [Symbol.iterator]() {
            return this;
        },
    };
}
