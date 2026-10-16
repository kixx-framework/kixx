import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { getMigration } from '../../../../app/transaction-scripts/migrations/get-migration.js';


const NOOP_ID = '2026-07-17-example-noop';


function makeRecord(attributes) {
    return {
        get(name) {
            return attributes[name];
        },
    };
}

function makeContext(getByMigrationId) {
    const reads = [];

    const collection = {
        async getByMigrationId(_context, id) {
            reads.push(id);
            return await getByMigrationId(id);
        },
    };

    return {
        reads,
        getCollection(name) {
            assertEqual('Migration', name);
            return collection;
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('getMigration transaction script', ({ it }) => {

    it('returns the pending projection when no ledger record exists', async () => {
        const context = makeContext(async () => null);

        const migration = await getMigration(context, NOOP_ID);

        assertEqual(NOOP_ID, migration.id);
        assert(migration.description.length > 0);
        assertEqual('pending', migration.status);
        assertEqual(null, migration.stats);
        assertEqual(null, migration.batchCount);
        assertEqual(null, migration.startedBy);
        assertEqual(null, migration.startedAt);
        assertEqual(null, migration.lastBatchAt);
        assertEqual(null, migration.completedAt);
        assertEqual(null, migration.error);
        assertEqual(1, context.reads.length);
        assertEqual(NOOP_ID, context.reads[0]);
    });

    it('returns every ledger field without the cursor', async () => {
        const record = makeRecord({
            status: 'applied',
            cursor: 'secret-cursor',
            stats: { scanned: 30 },
            batchCount: 3,
            startedBy: 'admin-1',
            startedAt: '2026-10-16T10:00:00.000Z',
            lastBatchAt: '2026-10-16T10:02:00.000Z',
            completedAt: '2026-10-16T10:02:00.000Z',
            error: null,
        });
        const context = makeContext(async () => record);

        const migration = await getMigration(context, NOOP_ID);

        assertEqual('applied', migration.status);
        assertEqual(30, migration.stats.scanned);
        assertEqual(3, migration.batchCount);
        assertEqual('admin-1', migration.startedBy);
        assertEqual('2026-10-16T10:00:00.000Z', migration.startedAt);
        assertEqual('2026-10-16T10:02:00.000Z', migration.lastBatchAt);
        assertEqual('2026-10-16T10:02:00.000Z', migration.completedAt);
        assertEqual(null, migration.error);
        assert(!Object.hasOwn(migration, 'cursor'));
    });

    it('returns null for an unregistered id without reading the ledger', async () => {
        const context = makeContext(async () => {
            throw new Error('ledger must not be read');
        });

        const migration = await getMigration(context, '2026-01-01-not-registered');

        assertEqual(null, migration);
        assertEqual(0, context.reads.length);
    });

    it('wraps a rejected ledger read in an AssertionError', async () => {
        const cause = new Error('storage offline');
        const context = makeContext(async () => {
            throw cause;
        });

        const error = await catchAsyncError(() => getMigration(context, NOOP_ID));

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual(cause, error.cause);
    });

    it('rejects an empty id', async () => {
        const context = makeContext(async () => null);

        const error = await catchAsyncError(() => getMigration(context, ''));

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual(0, context.reads.length);
    });
});
