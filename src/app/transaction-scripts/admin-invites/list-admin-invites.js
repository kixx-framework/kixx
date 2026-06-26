import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Returns a page of admin invites for the management UI, newest first.
 *
 * Each item carries derived lifecycle status and metadata but never a token: the
 * raw token is unrecoverable after creation, and the record id is the token hash,
 * which is safe to expose and is what the revoke action references.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} [params] - Listing parameters.
 * @param {string} [params.cursor] - Opaque cursor from a previous page.
 * @returns {Promise<{ items: Object[], cursor: string|null }>} Status-annotated invites and the next-page cursor.
 * @throws {AssertionError} When an unexpected storage failure occurs while listing invites.
 */
export async function listAdminInvites(context, params) {
    const { cursor } = params ?? {};
    const invites = context.getCollection('AdminInvite');

    let page;
    try {
        page = await invites.listPage(context, { cursor });
    } catch (cause) {
        throw new AssertionError('Unexpected error while listing admin invites', { cause });
    }

    return {
        items: page.items.map(presentInvite),
        cursor: page.cursor,
    };
}

function presentInvite(record) {
    return {
        id: record.id,
        kind: record.get('kind'),
        status: record.getStatus(),
        createdBy: record.get('createdBy'),
        createdAt: record.get('inviteCreationDate'),
        expiresAt: record.get('inviteExpirationDate'),
        consumedAt: record.get('consumedAt'),
        revokedAt: record.get('revokedAt'),
    };
}
