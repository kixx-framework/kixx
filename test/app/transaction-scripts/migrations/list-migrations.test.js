import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { migrations } from '../../../../src/app/migrations/mod.js';
import { listMigrations } from '../../../../src/app/transaction-scripts/migrations/list-migrations.js';


const FIRST_ID = '2026-07-17-first-migration';
const SECOND_ID = '2026-07-18-second-migration';


describe('listMigrations Transaction Script', ({ it }) => {
    it('returns pending statuses in registry iteration order', async () => {
        await withRegistry(makeRegistry(), async () => {
            const { context, requestedIds } = makeContext();
            const results = await listMigrations(context);

            assertEqual(2, results.length);
            assertEqual(FIRST_ID, results[0].id);
            assertEqual('First migration.', results[0].description);
            assertPending(results[0]);
            assertEqual(SECOND_ID, results[1].id);
            assertEqual('Second migration.', results[1].description);
            assertPending(results[1]);
            assertEqual(`${ FIRST_ID },${ SECOND_ID }`, requestedIds.join(','));
        });
    });

    it('merges registry descriptions with stored ledger status', async () => {
        const record = makeLedgerRecord();

        await withRegistry(makeRegistry([ makeEntry(FIRST_ID, 'Current registry description.') ]), async () => {
            const { context } = makeContext(new Map([ [ FIRST_ID, record ] ]));
            const [ result ] = await listMigrations(context);

            assertEqual(FIRST_ID, result.id);
            assertEqual('Current registry description.', result.description);
            assertEqual('failed', result.status);
            assertEqual(record.stats, result.stats);
            assertEqual(3, result.batchCount);
            assertEqual('admin-1', result.startedBy);
            assertEqual('2026-07-17T12:00:00.000Z', result.startedAt);
            assertEqual('2026-07-17T12:03:00.000Z', result.completedAt);
            assertEqual('The migration failed safely.', result.error);
            assertEqual(undefined, result.cursor);
            assertEqual(undefined, result.lastBatchAt);
        });
    });

    it('does not expose ledger records absent from the registry', async () => {
        const orphanId = '2026-07-19-orphaned-migration';

        await withRegistry(makeRegistry([ makeEntry(FIRST_ID, 'First migration.') ]), async () => {
            const records = new Map([ [ orphanId, makeLedgerRecord() ] ]);
            const { context, requestedIds } = makeContext(records);
            const results = await listMigrations(context);

            assertEqual(1, results.length);
            assertEqual(FIRST_ID, results[0].id);
            assertEqual(FIRST_ID, requestedIds.join(','));
        });
    });
});

function assertPending(result) {
    assertEqual('pending', result.status);
    assertEqual(null, result.stats);
    assertEqual(null, result.batchCount);
    assertEqual(null, result.startedBy);
    assertEqual(null, result.startedAt);
    assertEqual(null, result.completedAt);
    assertEqual(null, result.error);
}

function makeContext(records = new Map()) {
    const requestedIds = [];
    const collection = {
        async getByMigrationId(_context, id) {
            requestedIds.push(id);
            return records.get(id) ?? null;
        },
    };
    const context = {
        getCollection(name) {
            assertEqual('Migration', name);
            return collection;
        },
    };

    return { context, requestedIds };
}

function makeLedgerRecord() {
    return {
        status: 'failed',
        stats: { scanned: 12, updated: 3 },
        batchCount: 3,
        startedBy: 'admin-1',
        startedAt: '2026-07-17T12:00:00.000Z',
        completedAt: '2026-07-17T12:03:00.000Z',
        error: 'The migration failed safely.',
        cursor: 'internal-cursor',
        lastBatchAt: '2026-07-17T12:02:00.000Z',
    };
}

function makeRegistry(entries = [
    makeEntry(FIRST_ID, 'First migration.'),
    makeEntry(SECOND_ID, 'Second migration.'),
]) {
    return new Map(entries.map(entry => [ entry.id, entry ]));
}

function makeEntry(id, description) {
    return {
        id,
        description,
        migrate: async () => ({ done: true, cursor: null, stats: {} }),
    };
}

async function withRegistry(registry, fn) {
    const originalEntries = Array.from(migrations.entries());

    migrations.clear();
    for (const [ id, entry ] of registry) {
        migrations.set(id, entry);
    }

    try {
        await fn();
    } finally {
        migrations.clear();
        for (const [ id, entry ] of originalEntries) {
            migrations.set(id, entry);
        }
    }
}
