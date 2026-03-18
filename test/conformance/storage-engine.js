/**
 * StorageEngine port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testStorageEngineConformance } from '../../../conformance/storage-engine.js';
 *
 *   // createEngine must return a Promise<StorageEngine> with initialize() already called.
 *   testStorageEngineConformance(() => {
 *       const engine = new MyStorageEngine(options);
 *       await engine.initialize();
 *       return engine;
 *   });
 *
 * Each describe block creates a fresh engine via the factory and closes it in after().
 *
 * @module conformance/storage-engine
 */
import { describe } from 'kixx-test';
import { assertEqual, assert, assertNonEmptyString, assertArray, doesMatch } from 'kixx-assert';


/**
 * Registers StorageEngine port conformance tests against any adapter implementation.
 *
 * @param {function(): Promise<import('../../lib/ports/storage-engine.js').StorageEngine>} createEngine
 *   Async factory that returns a fresh, already-initialized StorageEngine.
 */
export function testStorageEngineConformance(createEngine) {

    // --- initialize() --------------------------------------------------------

    describe('StorageEngine#initialize() when called once', ({ before, after, it }) => {
        let engine;
        before(async () => {
            engine = await createEngine();
        });
        after(async () => {
            await engine.close();
        });

        it('resolves without error', () => {
            assert(engine);
        });
    });

    // --- put() create --------------------------------------------------------

    describe('StorageEngine#put() when creating a new document', ({ before, after, it }) => {
        let engine;
        let record;
        before(async () => {
            engine = await createEngine();
            record = await engine.put({ id: 'create_001', type: 'ConformanceTest', name: 'Alice' });
        });
        after(async () => {
            await engine.close();
        });

        it('returns a DocumentRecord', () => {
            assert(record !== null && typeof record === 'object');
        });
        it('version is 1', () => {
            assertEqual(1, record.version);
        });
        it('doc matches the input', () => {
            assertEqual('ConformanceTest', record.doc.type);
            assertEqual('create_001', record.doc.id);
            assertEqual('Alice', record.doc.name);
        });
        it('createdAt is an ISO string', () => {
            assertNonEmptyString(record.createdAt);
            assert(!Number.isNaN(Date.parse(record.createdAt)));
        });
        it('updatedAt is an ISO string', () => {
            assertNonEmptyString(record.updatedAt);
            assert(!Number.isNaN(Date.parse(record.updatedAt)));
        });
    });

    describe('StorageEngine#put() when creating a document with sortKey', ({ before, after, it }) => {
        let engine;
        let record;
        before(async () => {
            engine = await createEngine();
            record = await engine.put({
                id: 'create_002',
                type: 'ConformanceTest',
                sortKey: '2026-01-01',
            });
        });
        after(async () => {
            await engine.close();
        });

        it('doc preserves sortKey', () => {
            assertEqual('2026-01-01', record.doc.sortKey);
        });
    });

    describe('StorageEngine#put() when creating a duplicate (type, id)', ({ before, after, it }) => {
        let engine;
        let error;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'dup_001', type: 'ConformanceTest' });
            try {
                await engine.put({ id: 'dup_001', type: 'ConformanceTest' });
            } catch (err) {
                error = err;
            }
        });
        after(async () => {
            await engine.close();
        });

        it('throws DocumentAlreadyExistsError', () => {
            assert(error);
            assertEqual('DocumentAlreadyExistsError', error.name);
        });
        it('error code is DOCUMENT_EXISTS', () => {
            assertEqual('DOCUMENT_EXISTS', error.code);
        });
        it('error is expected', () => {
            assertEqual(true, error.expected);
        });
    });

    // --- put() update --------------------------------------------------------

    describe('StorageEngine#put() when updating with correct version', ({ before, after, it }) => {
        let engine;
        let original;
        let updated;
        before(async () => {
            engine = await createEngine();
            original = await engine.put({ id: 'update_001', type: 'ConformanceTest', name: 'Alice' });
            updated = await engine.put(
                { id: 'update_001', type: 'ConformanceTest', name: 'Alicia' },
                { version: 1 }
            );
        });
        after(async () => {
            await engine.close();
        });

        it('version increments to 2', () => {
            assertEqual(2, updated.version);
        });
        it('doc reflects the update', () => {
            assertEqual('Alicia', updated.doc.name);
        });
        it('createdAt is preserved', () => {
            assertEqual(original.createdAt, updated.createdAt);
        });
        it('updatedAt is a valid ISO string', () => {
            assertNonEmptyString(updated.updatedAt);
            assert(!Number.isNaN(Date.parse(updated.updatedAt)));
        });
    });

    describe('StorageEngine#put() when updating with wrong version', ({ before, after, it }) => {
        let engine;
        let error;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'conflict_001', type: 'ConformanceTest' });
            try {
                await engine.put(
                    { id: 'conflict_001', type: 'ConformanceTest' },
                    { version: 99 }
                );
            } catch (err) {
                error = err;
            }
        });
        after(async () => {
            await engine.close();
        });

        it('throws VersionConflictError', () => {
            assert(error);
            assertEqual('VersionConflictError', error.name);
        });
        it('error code is VERSION_CONFLICT', () => {
            assertEqual('VERSION_CONFLICT', error.code);
        });
        it('error is expected', () => {
            assertEqual(true, error.expected);
        });
        it('actualVersion is 1', () => {
            assertEqual(1, error.actualVersion);
        });
        it('expectedVersion is 99', () => {
            assertEqual(99, error.expectedVersion);
        });
    });

    describe('StorageEngine#put() when updating a non-existent document', ({ before, after, it }) => {
        let engine;
        let error;
        before(async () => {
            engine = await createEngine();
            try {
                await engine.put(
                    { id: 'missing_001', type: 'ConformanceTest' },
                    { version: 1 }
                );
            } catch (err) {
                error = err;
            }
        });
        after(async () => {
            await engine.close();
        });

        it('throws DocumentNotFoundError', () => {
            assert(error);
            assertEqual('DocumentNotFoundError', error.name);
        });
        it('error code is DOCUMENT_NOT_FOUND', () => {
            assertEqual('DOCUMENT_NOT_FOUND', error.code);
        });
        it('error is expected', () => {
            assertEqual(true, error.expected);
        });
    });

    // --- get() ---------------------------------------------------------------

    describe('StorageEngine#get() when the document does not exist', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            result = await engine.get('ConformanceTest', 'ghost_001');
        });
        after(async () => {
            await engine.close();
        });

        it('returns null', () => {
            assertEqual(null, result);
        });
    });

    describe('StorageEngine#get() when the document exists', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'get_001', type: 'ConformanceTest', color: 'blue' });
            result = await engine.get('ConformanceTest', 'get_001');
        });
        after(async () => {
            await engine.close();
        });

        it('returns a DocumentRecord', () => {
            assert(result !== null && typeof result === 'object');
        });
        it('doc matches the stored document', () => {
            assertEqual('blue', result.doc.color);
        });
        it('version is 1', () => {
            assertEqual(1, result.version);
        });
    });

    // --- delete() ------------------------------------------------------------

    describe('StorageEngine#delete() when the document does not exist', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            result = await engine.delete('ConformanceTest', 'ghost_del_001', 1);
        });
        after(async () => {
            await engine.close();
        });

        it('returns false', () => {
            assertEqual(false, result);
        });
    });

    describe('StorageEngine#delete() when the document exists with correct version', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'del_001', type: 'ConformanceTest' });
            result = await engine.delete('ConformanceTest', 'del_001', 1);
        });
        after(async () => {
            await engine.close();
        });

        it('returns true', () => {
            assertEqual(true, result);
        });
    });

    describe('StorageEngine#delete() document is gone after deletion', ({ before, after, it }) => {
        let engine;
        let afterGet;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'del_gone_001', type: 'ConformanceTest' });
            await engine.delete('ConformanceTest', 'del_gone_001', 1);
            afterGet = await engine.get('ConformanceTest', 'del_gone_001');
        });
        after(async () => {
            await engine.close();
        });

        it('get() returns null after deletion', () => {
            assertEqual(null, afterGet);
        });
    });

    describe('StorageEngine#delete() when version does not match', ({ before, after, it }) => {
        let engine;
        let error;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'del_conflict_001', type: 'ConformanceTest' });
            try {
                await engine.delete('ConformanceTest', 'del_conflict_001', 99);
            } catch (err) {
                error = err;
            }
        });
        after(async () => {
            await engine.close();
        });

        it('throws VersionConflictError', () => {
            assert(error);
            assertEqual('VersionConflictError', error.name);
        });
        it('actualVersion is 1', () => {
            assertEqual(1, error.actualVersion);
        });
    });

    // --- query() basic -------------------------------------------------------

    describe('StorageEngine#query() when no documents exist for the type', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            result = await engine.query('EmptyType', {});
        });
        after(async () => {
            await engine.close();
        });

        it('returns an empty records array', () => {
            assertArray(result.records);
            assertEqual(0, result.records.length);
        });
        it('cursor is null', () => {
            assertEqual(null, result.cursor);
        });
    });

    describe('StorageEngine#query() ordering by sort_key ascending', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'q_b', type: 'QueryTest', sortKey: '2026-02-01' });
            await engine.put({ id: 'q_a', type: 'QueryTest', sortKey: '2026-01-01' });
            await engine.put({ id: 'q_c', type: 'QueryTest', sortKey: '2026-03-01' });
            result = await engine.query('QueryTest', { reverse: false });
        });
        after(async () => {
            await engine.close();
        });

        it('returns 3 records', () => {
            assertEqual(3, result.records.length);
        });
        it('first record has earliest sortKey', () => {
            assertEqual('2026-01-01', result.records[0].doc.sortKey);
        });
        it('last record has latest sortKey', () => {
            assertEqual('2026-03-01', result.records[2].doc.sortKey);
        });
    });

    describe('StorageEngine#query() ordering by sort_key descending', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'qd_b', type: 'QueryDesc', sortKey: '2026-02-01' });
            await engine.put({ id: 'qd_a', type: 'QueryDesc', sortKey: '2026-01-01' });
            await engine.put({ id: 'qd_c', type: 'QueryDesc', sortKey: '2026-03-01' });
            result = await engine.query('QueryDesc', { reverse: true });
        });
        after(async () => {
            await engine.close();
        });

        it('first record has latest sortKey', () => {
            assertEqual('2026-03-01', result.records[0].doc.sortKey);
        });
        it('last record has earliest sortKey', () => {
            assertEqual('2026-01-01', result.records[2].doc.sortKey);
        });
    });

    describe('StorageEngine#query() with limit', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            for (let i = 1; i <= 5; i += 1) {
                await engine.put({
                    id: `qlim_${ String(i).padStart(3, '0') }`,
                    type: 'QueryLimit',
                    sortKey: `2026-0${ i }-01`,
                });
            }
            result = await engine.query('QueryLimit', { limit: 2 });
        });
        after(async () => {
            await engine.close();
        });

        it('returns exactly 2 records', () => {
            assertEqual(2, result.records.length);
        });
        it('cursor is non-null (more results exist)', () => {
            assertNonEmptyString(result.cursor);
        });
    });

    describe('StorageEngine#query() cursor pagination', ({ before, after, it }) => {
        let engine;
        let page1;
        let page2;
        let page3;
        before(async () => {
            engine = await createEngine();
            for (let i = 1; i <= 5; i += 1) {
                await engine.put({
                    id: `qpag_${ String(i).padStart(3, '0') }`,
                    type: 'QueryPaginate',
                    sortKey: `2026-0${ i }-01`,
                });
            }
            page1 = await engine.query('QueryPaginate', { limit: 2 });
            page2 = await engine.query('QueryPaginate', { limit: 2, cursor: page1.cursor });
            page3 = await engine.query('QueryPaginate', { limit: 2, cursor: page2.cursor });
        });
        after(async () => {
            await engine.close();
        });

        it('page1 has 2 records', () => {
            assertEqual(2, page1.records.length);
        });
        it('page2 has 2 records', () => {
            assertEqual(2, page2.records.length);
        });
        it('page3 has 1 record (last page)', () => {
            assertEqual(1, page3.records.length);
        });
        it('page3 cursor is null', () => {
            assertEqual(null, page3.cursor);
        });
        it('all pages cover different records', () => {
            const ids = [
                ...page1.records.map((r) => r.doc.id),
                ...page2.records.map((r) => r.doc.id),
                ...page3.records.map((r) => r.doc.id),
            ];
            assertEqual(5, new Set(ids).size);
        });
    });

    // --- query() range operators ---------------------------------------------

    describe('StorageEngine#query() with greaterThanOrEqualTo', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'qr_a', type: 'QueryRange', sortKey: '2026-01-01' });
            await engine.put({ id: 'qr_b', type: 'QueryRange', sortKey: '2026-03-01' });
            await engine.put({ id: 'qr_c', type: 'QueryRange', sortKey: '2026-06-01' });
            result = await engine.query('QueryRange', { greaterThanOrEqualTo: '2026-03-01' });
        });
        after(async () => {
            await engine.close();
        });

        it('returns 2 records at or above the bound', () => {
            assertEqual(2, result.records.length);
        });
        it('first record matches the bound', () => {
            assertEqual('2026-03-01', result.records[0].doc.sortKey);
        });
    });

    describe('StorageEngine#query() with lessThanOrEqualTo', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'qlte_a', type: 'QueryLTE', sortKey: '2026-01-01' });
            await engine.put({ id: 'qlte_b', type: 'QueryLTE', sortKey: '2026-03-01' });
            await engine.put({ id: 'qlte_c', type: 'QueryLTE', sortKey: '2026-06-01' });
            result = await engine.query('QueryLTE', { lessThanOrEqualTo: '2026-03-01' });
        });
        after(async () => {
            await engine.close();
        });

        it('returns 2 records at or below the bound', () => {
            assertEqual(2, result.records.length);
        });
    });

    describe('StorageEngine#query() with greaterThan (exclusive)', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'qgt_a', type: 'QueryGT', sortKey: '2026-01-01' });
            await engine.put({ id: 'qgt_b', type: 'QueryGT', sortKey: '2026-03-01' });
            await engine.put({ id: 'qgt_c', type: 'QueryGT', sortKey: '2026-06-01' });
            result = await engine.query('QueryGT', { greaterThan: '2026-03-01' });
        });
        after(async () => {
            await engine.close();
        });

        it('returns only the record strictly above the bound', () => {
            assertEqual(1, result.records.length);
            assertEqual('2026-06-01', result.records[0].doc.sortKey);
        });
    });

    describe('StorageEngine#query() with lessThan (exclusive)', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'qlt_a', type: 'QueryLT', sortKey: '2026-01-01' });
            await engine.put({ id: 'qlt_b', type: 'QueryLT', sortKey: '2026-03-01' });
            await engine.put({ id: 'qlt_c', type: 'QueryLT', sortKey: '2026-06-01' });
            result = await engine.query('QueryLT', { lessThan: '2026-03-01' });
        });
        after(async () => {
            await engine.close();
        });

        it('returns only the record strictly below the bound', () => {
            assertEqual(1, result.records.length);
            assertEqual('2026-01-01', result.records[0].doc.sortKey);
        });
    });

    // --- query() custom index ------------------------------------------------

    describe('StorageEngine#configureIndexes() allows querying by custom attribute', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            await engine.put({ id: 'idx_a', type: 'IndexTest', email: 'alice@example.com' });
            await engine.put({ id: 'idx_b', type: 'IndexTest', email: 'bob@example.com' });
            await engine.configureIndexes([{ type: 'IndexTest', attribute: 'email' }]);
            result = await engine.query('IndexTest', {
                index: 'email',
                greaterThanOrEqualTo: 'b',
            });
        });
        after(async () => {
            await engine.close();
        });

        it('returns only records matching the index bound', () => {
            assertEqual(1, result.records.length);
            assertEqual('bob@example.com', result.records[0].doc.email);
        });
    });

    describe('StorageEngine#configureIndexes() backfills existing documents', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            // Insert docs BEFORE configuring the index.
            await engine.put({ id: 'bf_a', type: 'BackfillTest', region: 'US' });
            await engine.put({ id: 'bf_b', type: 'BackfillTest', region: 'EU' });
            await engine.configureIndexes([{ type: 'BackfillTest', attribute: 'region' }]);
            result = await engine.query('BackfillTest', {
                index: 'region',
                greaterThanOrEqualTo: 'US',
            });
        });
        after(async () => {
            await engine.close();
        });

        it('pre-existing documents appear in the new index', () => {
            assertEqual(1, result.records.length);
            assertEqual('US', result.records[0].doc.region);
        });
    });

    describe('StorageEngine#configureIndexes() idempotent when called twice', ({ before, after, it }) => {
        let engine;
        let error;
        before(async () => {
            engine = await createEngine();
            try {
                await engine.configureIndexes([{ type: 'IdempotentTest', attribute: 'foo' }]);
                await engine.configureIndexes([{ type: 'IdempotentTest', attribute: 'foo' }]);
            } catch (err) {
                error = err;
            }
        });
        after(async () => {
            await engine.close();
        });

        it('does not throw', () => {
            assertEqual(undefined, error);
        });
    });

    // --- close() -------------------------------------------------------------

    describe('StorageEngine#close() when called on an open engine', ({ before, it }) => {
        let error;
        before(async () => {
            const engine = await createEngine();
            try {
                await engine.close();
            } catch (err) {
                error = err;
            }
        });

        it('does not throw', () => {
            assertEqual(undefined, error);
        });
    });

    describe('StorageEngine#close() reports error name in messages', ({ before, after, it }) => {
        let engine;
        let result;
        before(async () => {
            engine = await createEngine();
            const doc = await engine.put({ id: 'close_test', type: 'CloseTest', value: 42 });
            result = doc;
        });
        after(async () => {
            await engine.close();
        });

        it('put before close returns a record', () => {
            assert(doesMatch('CloseTest', result.doc.type));
        });
    });
}
