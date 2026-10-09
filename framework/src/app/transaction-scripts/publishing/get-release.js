import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Gets one Release audit record by content-derived id.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} releaseId - Release id to load.
 * @returns {Promise<Object|null>} Release metadata, or null when absent.
 * @throws {AssertionError} When an unexpected persistence failure occurs.
 */
export async function getRelease(context, releaseId) {
    const releases = context.getCollection('Release');

    try {
        const record = await releases.get(context, releaseId);
        return record ? record.toObject() : null;
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading a Release', { cause });
    }
}
