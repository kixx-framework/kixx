import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Lists Release audit metadata newest first.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} [params] - Pagination parameters.
 * @returns {Promise<{items: Object[], cursor: string|null}>} Release page.
 * @throws {InvalidCursorError} When the cursor is invalid.
 * @throws {AssertionError} When an unexpected persistence failure occurs.
 */
export async function listReleases(context, params) {
    const { cursor, limit } = params ?? {};
    const releases = context.getCollection('Release');

    try {
        const page = await releases.listPage(context, { cursor, limit });
        return {
            items: page.items.map((record) => record.toObject()),
            cursor: page.cursor,
        };
    } catch (cause) {
        if (cause.name === 'InvalidCursorError') {
            throw cause;
        }
        throw new AssertionError('Unexpected error while listing Releases', { cause });
    }
}
