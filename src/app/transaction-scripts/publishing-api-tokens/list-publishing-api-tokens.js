import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Returns a page of Publishing API tokens for the admin management UI, newest first.
 *
 * Each item carries derived lifecycle status and metadata but never the token or its
 * permission grants: the raw token is unrecoverable after creation, and the record id
 * is the token hash, which is safe to expose and is what the revoke action references.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} [params] - Listing parameters.
 * @param {string} [params.cursor] - Opaque cursor from a previous page.
 * @returns {Promise<{ items: Object[], cursor: string|null }>} Status-annotated tokens and the next-page cursor.
 * @throws {AssertionError} When an unexpected storage failure occurs while listing tokens.
 */
export async function listPublishingApiTokens(context, params) {
    const { cursor } = params ?? {};
    const publishingApiTokens = context.getCollection('PublishingApiToken');

    let page;
    try {
        page = await publishingApiTokens.listPage(context, { cursor });
    } catch (cause) {
        throw new AssertionError('Unexpected error while listing publishing API tokens', { cause });
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
        description: record.get('description'),
        createdBy: record.get('createdBy'),
        createdAt: record.get('tokenCreationDate'),
        expiresAt: record.get('tokenExpirationDate'),
        revokedAt: record.get('revokedAt'),
    };
}
