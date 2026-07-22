import { listMigrations as listRegisteredMigrations } from '../../migrations/mod.js';
import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Lists registry-authoritative migration status in deployment order.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @returns {Promise<Object[]>} Migration descriptions merged with durable lifecycle status.
 * @throws {AssertionError} When an unexpected ledger read fails.
 */
export async function listMigrations(context) {
    const migrationLedger = context.getCollection('Migration');
    const registeredMigrations = listRegisteredMigrations();

    let ledgerRecords;
    try {
        ledgerRecords = await Promise.all(registeredMigrations.map(async ({ id }) => {
            return await migrationLedger.getByMigrationId(context, id);
        }));
    } catch (cause) {
        throw new AssertionError('Unexpected error while listing migration status', { cause });
    }

    // Registry entries define both visibility and order. A ledger scan would
    // expose retired or malformed records which are not runnable in this build.
    return registeredMigrations.map((entry, index) => {
        return presentMigration(entry, ledgerRecords[index]);
    });
}

function presentMigration(entry, record) {
    if (!record) {
        return {
            id: entry.id,
            description: entry.description,
            status: 'pending',
            stats: null,
            batchCount: null,
            startedBy: null,
            startedAt: null,
            completedAt: null,
            error: null,
        };
    }

    return {
        id: entry.id,
        description: entry.description,
        status: record.status,
        stats: record.stats,
        batchCount: record.batchCount,
        startedBy: record.startedBy,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        error: record.error,
    };
}
