import { getMigration as getRegisteredMigration } from '../../migrations/mod.js';
import { presentMigration } from './lib/present-migration.js';
import { AssertionError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';


/**
 * Loads one registered migration merged with its durable lifecycle status.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} id - Permanent migration id.
 * @returns {Promise<Object|null>} Migration status projection, or null when the id is not registered.
 * @throws {AssertionError} When id is invalid or an unexpected ledger read fails.
 */
export async function getMigration(context, id) {
    assertNonEmptyString(id, 'getMigration() id');

    // The registry decides visibility; an unregistered id never reaches the ledger.
    const entry = getRegisteredMigration(id);
    if (!entry) {
        return null;
    }

    let record;
    try {
        record = await context.getCollection('Migration').getByMigrationId(context, id);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading migration status', { cause });
    }

    return presentMigration(entry, record);
}
