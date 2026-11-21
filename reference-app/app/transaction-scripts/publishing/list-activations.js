import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Lists activation audit metadata newest first.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} [params] - Pagination and optional build filter.
 * @returns {Promise<{items: Object[], cursor: string|null}>} Activation page.
 * @throws {InvalidCursorError} When the cursor is invalid.
 * @throws {AssertionError} When an unexpected persistence failure occurs.
 */
export async function listActivations(context, params) {
    const { buildId, cursor, limit } = params ?? {};
    const activations = context.getCollection('Activation');

    try {
        const page = await activations.listPage(context, { buildId, cursor, limit });
        return {
            items: page.items.map((record) => record.toObject()),
            cursor: page.cursor,
        };
    } catch (cause) {
        if (cause.name === 'InvalidCursorError') {
            throw cause;
        }
        throw new AssertionError('Unexpected error while listing Release activations', { cause });
    }
}
