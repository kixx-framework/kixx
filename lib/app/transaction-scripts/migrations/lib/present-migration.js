/**
 * Merges a registry entry with its ledger record into the status projection
 * shared by the migration read scripts. The ledger cursor is never exposed.
 * @param {{id: string, description: string}} entry - Registered migration.
 * @param {import('../../../collections/migration-record.js').default|null} record - Ledger record, or null before the first real run.
 * @returns {Object} Migration status projection.
 */
export function presentMigration(entry, record) {
    if (!record) {
        return {
            id: entry.id,
            description: entry.description,
            status: 'pending',
            stats: null,
            batchCount: null,
            startedBy: null,
            startedAt: null,
            lastBatchAt: null,
            completedAt: null,
            error: null,
        };
    }

    return {
        id: entry.id,
        description: entry.description,
        status: record.get('status'),
        stats: record.get('stats'),
        batchCount: record.get('batchCount'),
        startedBy: record.get('startedBy'),
        startedAt: record.get('startedAt'),
        lastBatchAt: record.get('lastBatchAt'),
        completedAt: record.get('completedAt'),
        error: record.get('error'),
    };
}
