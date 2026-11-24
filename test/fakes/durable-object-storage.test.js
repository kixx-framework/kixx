import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createFakeDurableObjectStorage } from './durable-object-storage.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeStorage(options) {
    const storage = createFakeDurableObjectStorage(options);
    storage.sql.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB)');
    return storage;
}

function readValue(storage, key) {
    return storage.sql.exec('SELECT v FROM t WHERE k = ?', key).one().v;
}

function readKeys(storage) {
    return storage.sql.exec('SELECT k FROM t ORDER BY k').toArray().map((row) => row.k).join(',');
}

function countRows(storage) {
    return storage.sql.exec('SELECT count(*) AS n FROM t').one().n;
}

function listTables(storage) {
    return storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").toArray().map((row) => row.name).join(',');
}


describe('createFakeDurableObjectStorage', ({ describe }) => {
    describe('sql.exec', ({ it }) => {
        it('returns BLOBs as standalone ArrayBuffers in plain-object rows', () => {
            const storage = makeStorage();
            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'a', new Uint8Array([ 1, 2, 3 ]));

            const [ row ] = storage.sql.exec('SELECT k, v FROM t').toArray();

            assertEqual(Object.prototype, Object.getPrototypeOf(row));
            assert(row.v instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual(3, row.v.byteLength);
            assertEqual('1,2,3', Array.from(new Uint8Array(row.v)).join(','));
        });

        it('returns strings, numbers, and null as they are', () => {
            const storage = makeStorage();

            const row = storage.sql.exec('SELECT ? AS a, ? AS b, ? AS c, ? AS d', 'héllo', 42, 1.5, null).one();

            assertEqual('héllo', row.a);
            assertEqual(42, row.b);
            assertEqual(1.5, row.c);
            assertEqual(null, row.d);
        });

        it('binds exactly the bytes of a subarray', () => {
            const storage = makeStorage();
            const bytes = new Uint8Array([ 9, 8, 7, 6, 5, 4 ]);

            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'sub', bytes.subarray(2, 4));

            assertEqual('7,6', Array.from(new Uint8Array(readValue(storage, 'sub'))).join(','));
        });

        it('accepts ArrayBuffer bindings', () => {
            const storage = makeStorage();

            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'ab', new Uint8Array([ 4, 5 ]).buffer);

            assertEqual('4,5', Array.from(new Uint8Array(readValue(storage, 'ab'))).join(','));
        });

        it('binds empty views as empty BLOBs, not null', () => {
            const storage = makeStorage();

            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'sub', new Uint8Array(0).subarray(0, 4));
            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'text', new TextEncoder().encode(''));

            const rows = storage.sql.exec('SELECT k, typeof(v) AS t FROM t ORDER BY k').toArray();
            assertEqual('sub:blob,text:blob', rows.map((row) => `${ row.k }:${ row.t }`).join(','));
        });

        it('binds undefined as null', () => {
            const storage = makeStorage();

            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'u', undefined);

            assertEqual(null, readValue(storage, 'u'));
        });

        it('rejects a binding that is not a string, number, null, undefined, ArrayBuffer, or view', () => {
            const storage = makeStorage();

            for (const value of [ new Date(0), {}, [ 1 ], true, 5n, new Map() ]) {
                const caught = catchError(() => {
                    storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', value, 'shifted');
                });

                assert(caught, `expected ${ Object.prototype.toString.call(value) } to throw`);
                assertEqual('TypeError', caught.name);
                assertMatches('binding 1 must be', caught.message);
            }

            assertEqual(0, countRows(storage));
        });

        it('accepts bindings totaling exactly 2,000,000 bytes', () => {
            const storage = makeStorage();

            storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'max', new Uint8Array(2000000 - 3));
            const { n } = storage.sql.exec('SELECT length(?) AS n', new Uint8Array(2000000)).one();

            assertEqual(2000000, n);
            assertEqual(1, countRows(storage));
        });

        it('rejects bindings totaling 2,000,001 bytes with SQLITE_TOOBIG', () => {
            const storage = makeStorage();

            const oneBinding = catchError(() => {
                storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', null, new Uint8Array(2000001));
            });
            const twoBindings = catchError(() => {
                storage.sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'big', new Uint8Array(2000000 - 2));
            });

            assert(oneBinding, 'expected the oversized binding to throw');
            assertMatches(/^SQLITE_TOOBIG/, oneBinding.message);
            assert(twoBindings, 'expected the oversized total to throw');
            assertMatches(/^SQLITE_TOOBIG/, twoBindings.message);
            assertEqual(0, countRows(storage));
        });

        it('counts string bindings in UTF-8 bytes', () => {
            const storage = makeStorage();

            // 'é' is one character and two bytes.
            const fits = 'é'.repeat(1000000);
            const { n } = storage.sql.exec('SELECT length(?) AS n', fits).one();
            const caught = catchError(() => storage.sql.exec('SELECT length(?) AS n', `${ fits }a`));

            assertEqual(1000000, n);
            assert(caught, 'expected the oversized string to throw');
            assertMatches(/^SQLITE_TOOBIG/, caught.message);
        });

        it('accepts 100 bindings and rejects 101', () => {
            const storage = makeStorage();
            const sum = (count) => `SELECT ${ new Array(count).fill('?').join(' + ') } AS n`;

            const { n } = storage.sql.exec(sum(100), ...new Array(100).fill(1)).one();
            const caught = catchError(() => storage.sql.exec(sum(101), ...new Array(101).fill(1)));

            assertEqual(100, n);
            assert(caught, 'expected 101 bindings to throw');
            assertMatches('101 bindings', caught.message);
        });

        it('accepts a statement of 100,000 bytes and rejects a longer one', () => {
            const storage = makeStorage();
            const select = (literal) => `SELECT length('${ literal }') AS n`;
            const padding = 100000 - select('').length;

            const { n } = storage.sql.exec(select('x'.repeat(padding))).one();
            const caught = catchError(() => storage.sql.exec(select('x'.repeat(padding + 1))));

            assertEqual(padding, n);
            assert(caught, 'expected the long statement to throw');
            assertMatches('100001 bytes', caught.message);
        });

        it('measures the statement in UTF-8 bytes, not characters', () => {
            const storage = makeStorage();

            // 50,000 characters and 100,000 bytes, plus the rest of the statement.
            const caught = catchError(() => storage.sql.exec(`SELECT length('${ 'é'.repeat(50000) }') AS n`));

            assert(caught, 'expected the long statement to throw');
            assertMatches('byte statement limit', caught.message);
        });

        it('rejects transaction statements', () => {
            const storage = makeStorage();
            const statements = [
                'BEGIN',
                'BEGIN TRANSACTION',
                'COMMIT',
                'END',
                'ROLLBACK',
                'SAVEPOINT s',
                'RELEASE s',
                '  \n begin immediate',
            ];

            for (const statement of statements) {
                const caught = catchError(() => storage.sql.exec(statement));

                assert(caught, `expected ${ statement.trim() } to throw`);
                assertMatches('cannot run the transaction statement', caught.message);
            }

            // Nothing began a transaction, so one can still start.
            storage.transactionSync(() => storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'a'));
            assertEqual(1, countRows(storage));
        });

        it('accepts a statement that only mentions a transaction keyword', () => {
            const storage = makeStorage();

            const { word } = storage.sql.exec("SELECT 'COMMIT' AS word").one();
            storage.sql.exec('CREATE TABLE endings (release TEXT)');

            assertEqual('COMMIT', word);
            assertEqual('endings,t', listTables(storage));
        });

        it('rejects a query holding more than one statement, running none of it', () => {
            const storage = createFakeDurableObjectStorage();

            const caught = catchError(() => storage.sql.exec('CREATE TABLE a (x); CREATE TABLE b (y)'));

            assert(caught, 'expected the multi-statement query to throw');
            assertEqual('multi-statement queries are not modeled by this fake', caught.message);
            assertEqual('', listTables(storage));
        });

        it('rejects a comment after the statement, which the platform accepts', () => {
            const storage = makeStorage();

            const caught = catchError(() => storage.sql.exec('SELECT 1 AS n; -- note'));

            assert(caught, 'expected the trailing comment to throw');
            assertEqual('multi-statement queries are not modeled by this fake', caught.message);
        });

        it('accepts one statement with a trailing semicolon or surrounding whitespace', () => {
            const storage = makeStorage();

            assertEqual(1, storage.sql.exec('SELECT 1 AS n;').one().n);
            assertEqual(1, storage.sql.exec('\n    SELECT 1 AS n;\n    ').one().n);
            assertEqual(1, storage.sql.exec('\n    SELECT 1 AS n\n').one().n);
        });

        it('accepts a semicolon inside a string literal or a quoted identifier', () => {
            const storage = makeStorage();

            assertEqual(';', storage.sql.exec("SELECT ';' AS semi").one().semi);
            assertEqual('a;b', storage.sql.exec("SELECT 'a;b' AS \"x;y\";").one()['x;y']);
            assertEqual('世界; 😀', storage.sql.exec("SELECT '世界; 😀' AS v").one().v);
        });

        it('rejects a query holding no statement', () => {
            const storage = makeStorage();

            for (const query of [ '', '   ', '-- only a comment', ';' ]) {
                const caught = catchError(() => storage.sql.exec(query));

                assert(caught, `expected ${ JSON.stringify(query) } to throw`);
                assertEqual('the query does not contain a statement', caught.message);
            }
        });
    });

    describe('cursor', ({ it }) => {
        it('returns the only row from one()', () => {
            const storage = makeStorage();
            storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'a');

            assertEqual('a', storage.sql.exec('SELECT k FROM t').one().k);
        });

        it('throws from one() unless there is exactly one row', () => {
            const storage = makeStorage();

            const none = catchError(() => storage.sql.exec('SELECT k FROM t').one());
            storage.sql.exec('INSERT INTO t (k) VALUES (?), (?)', 'a', 'b');
            const two = catchError(() => storage.sql.exec('SELECT k FROM t').one());

            assert(none, 'expected one() to throw on zero rows');
            assertEqual('Expected exactly one result from SQL query, but got no results.', none.message);
            assert(two, 'expected one() to throw on two rows');
            assertEqual('Expected exactly one result from SQL query, but got 2 results.', two.message);
        });

        it('iterates the cursor', () => {
            const storage = makeStorage();
            storage.sql.exec('INSERT INTO t (k) VALUES (?), (?)', 'a', 'b');

            const keys = [];
            for (const row of storage.sql.exec('SELECT k FROM t ORDER BY k')) {
                keys.push(row.k);
            }

            assertEqual('a,b', keys.join(','));
        });

        it('is consumed as it is read', () => {
            const storage = makeStorage();
            storage.sql.exec('INSERT INTO t (k) VALUES (?), (?), (?)', 'a', 'b', 'c');
            const cursor = storage.sql.exec('SELECT k FROM t ORDER BY k');

            const first = cursor.next();
            const remaining = cursor.toArray();

            assertEqual(false, first.done);
            assertEqual('a', first.value.k);
            assertEqual('b,c', remaining.map((row) => row.k).join(','));
            assertEqual(0, cursor.toArray().length);
            assertEqual(true, cursor.next().done);
        });

        it('returns an empty cursor from a statement that returns no rows', () => {
            const storage = makeStorage();

            const cursor = storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'a');

            assertEqual(0, cursor.toArray().length);
            assertEqual(1, countRows(storage));
        });
    });

    describe('transactionSync', ({ it }) => {
        it('commits and returns the callback value', () => {
            const storage = makeStorage();

            const result = storage.transactionSync(() => {
                storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'a');
                return 'done';
            });

            assertEqual('done', result);
            assertEqual(1, countRows(storage));
        });

        it('rolls back when the callback throws', () => {
            const storage = makeStorage();

            const caught = catchError(() => storage.transactionSync(() => {
                storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'a');
                throw new Error('boom');
            }));

            assertEqual('boom', caught.message);
            assertEqual(0, countRows(storage));
        });

        it('nests, rolling back only the inner transaction on throw', () => {
            const storage = makeStorage();

            storage.transactionSync(() => {
                storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'outer');
                catchError(() => storage.transactionSync(() => {
                    storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'inner');
                    throw new Error('inner');
                }));
                storage.transactionSync(() => storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'kept'));
            });

            assertEqual('kept,outer', readKeys(storage));
        });

        it('rolls back and throws TypeError for a thenable-returning callback', () => {
            const storage = makeStorage();

            const caught = catchError(() => storage.transactionSync(async () => {
                storage.sql.exec('INSERT INTO t (k) VALUES (?)', 'a');
            }));

            assert(caught, 'expected a TypeError');
            assertEqual('TypeError', caught.name);
            assertEqual(0, countRows(storage));
        });
    });

    describe('with the default path', ({ it }) => {
        it('keeps each storage in its own in-memory database', () => {
            const first = makeStorage();
            const second = makeStorage();

            first.sql.exec('INSERT INTO t (k) VALUES (?)', 'a');

            assertEqual(1, countRows(first));
            assertEqual(0, countRows(second));
        });

        it('rejects statements after close()', () => {
            const storage = makeStorage();

            storage.close();

            assert(catchError(() => storage.sql.exec('SELECT 1 AS n')), 'expected exec() to throw after close()');
        });
    });

    describe('with a file path', ({ before, after, it }) => {
        let directory;

        before(() => {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kixx-fake-durable-object-storage-'));
        });

        after(() => {
            fs.rmSync(directory, { recursive: true, force: true });
        });

        it('reopens with committed rows and without rolled-back ones', () => {
            const filepath = path.join(directory, 'storage.sqlite');

            const first = makeStorage({ path: filepath });
            first.sql.exec('INSERT INTO t (k) VALUES (?)', 'bare');
            first.transactionSync(() => first.sql.exec('INSERT INTO t (k) VALUES (?)', 'committed'));
            catchError(() => first.transactionSync(() => {
                first.sql.exec('INSERT INTO t (k) VALUES (?)', 'rolled-back');
                throw new Error('boom');
            }));
            first.close();

            const second = createFakeDurableObjectStorage({ path: filepath });
            const keys = readKeys(second);
            second.close();

            assertEqual('bare,committed', keys);
        });
    });
});
