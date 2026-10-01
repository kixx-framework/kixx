import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Returns a page of Administrative Data API tokens for the admin management UI, newest first.
 *
 * Items carry derived status, grants, and audit metadata but never the token:
 * the raw secret is unrecoverable after creation. The record id is the token
 * hash, which cannot be reversed into a credential and is what revocation
 * references.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} [params] - Listing parameters.
 * @param {string} [params.cursor] - Opaque cursor from a previous page.
 * @returns {Promise<{ items: Object[], cursor: string|null }>} Status-annotated tokens and the next-page cursor.
 * @throws {InvalidCursorError} When cursor is not a valid signed document-store cursor.
 * @throws {AssertionError} When an unexpected storage failure occurs while listing tokens.
 */
export async function listAdminDataApiTokens(context, params) {
    const { cursor } = params ?? {};
    const tokens = context.getCollection('AdminDataApiToken');

    let page;
    try {
        page = await tokens.listPage(context, { cursor });
    } catch (cause) {
        if (cause.name === 'InvalidCursorError') {
            throw cause;
        }
        throw new AssertionError('Unexpected error while listing admin data API tokens', { cause });
    }

    return {
        items: page.items.map(presentToken),
        cursor: page.cursor,
    };
}

function presentToken(record) {
    return {
        id: record.id,
        status: record.getStatus(),
        grants: record.get('grants'),
        description: record.get('description'),
        createdBy: record.get('createdBy'),
        createdAt: record.get('tokenCreationDate'),
        expiresAt: record.get('tokenExpirationDate'),
        revokedAt: record.get('revokedAt'),
    };
}
