import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { listMigrations } from '../../../../app/transaction-scripts/migrations/list-migrations.js';
import { listMigrations as listRegisteredMigrations } from '../../../../app/migrations/mod.js';


function makeRecord(attributes) {
    return {
        get(name) {
            return attributes[name];
        },
    };
}

function makeContext(getByMigrationId) {
    const collection = {
        async getByMigrationId(_context, id) {
            return await getByMigrationId(id);
        },
    };

    return {
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


describe('listMigrations transaction script', ({ it }) => {

    it('returns registered migrations in registry order', async () => {
        const context = makeContext(async () => null);

        const migrations = await listMigrations(context);

        const expectedIds = listRegisteredMigrations().map(({ id }) => id);
        assertEqual(expectedIds.join(','), migrations.map(({ id }) => id).join(','));
        assertEqual('pending', migrations[0].status);
        assertEqual(null, migrations[0].lastBatchAt);
    });

    it('includes lastBatchAt and omits the cursor', async () => {
        const record = makeRecord({
            status: 'running',
            cursor: 'secret-cursor',
            stats: { scanned: 10 },
            batchCount: 1,
            startedBy: 'admin-1',
            startedAt: '2026-10-16T10:00:00.000Z',
            lastBatchAt: '2026-10-16T10:01:00.000Z',
            completedAt: null,
            error: null,
        });
        const context = makeContext(async () => record);

        const [ migration ] = await listMigrations(context);

        assertEqual('running', migration.status);
        assertEqual('2026-10-16T10:01:00.000Z', migration.lastBatchAt);
        assert(!Object.hasOwn(migration, 'cursor'));
    });

    it('wraps a rejected ledger read in an AssertionError', async () => {
        const cause = new Error('storage offline');
        const context = makeContext(async () => {
            throw cause;
        });

        const error = await catchAsyncError(() => listMigrations(context));

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual(cause, error.cause);
    });
});
