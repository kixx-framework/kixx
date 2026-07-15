import { AssertionError } from '../../../kixx/errors/mod.js';

// Keeps the admin invites management page to a short, scannable list per page
// rather than the collection's general-purpose default page size.
const INVITES_PER_PAGE = 10;

/**
 * Returns a page of admin invites for the management UI, newest first.
 *
 * Each item carries derived lifecycle status and metadata but never a token: the
 * raw token is unrecoverable after creation, and the record id is the token hash,
 * which is safe to expose and is what the revoke action references. `createdBy` is
 * resolved from the authoring admin user's id to their email address for display;
 * it falls back to the raw id if that admin user no longer exists.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} [params] - Listing parameters.
 * @param {string} [params.cursor] - Opaque cursor from a previous page.
 * @returns {Promise<{ items: Object[], cursor: string|null }>} Status-annotated invites and the next-page cursor.
 * @throws {InvalidCursorError} When cursor is not a valid signed document-store cursor.
 * @throws {AssertionError} When an unexpected storage failure occurs while listing invites.
 */
export async function listAdminInvites(context, params) {
    const { cursor } = params ?? {};
    const invites = context.getCollection('AdminInvite');
    const adminUsers = context.getCollection('AdminUser');

    let page;
    let createdByEmailsById;
    try {
        page = await invites.listPage(context, { cursor, limit: INVITES_PER_PAGE });
        createdByEmailsById = await getCreatedByEmailsById(context, adminUsers, page.items);
    } catch (cause) {
        if (cause.name === 'InvalidCursorError') {
            throw cause;
        }
        throw new AssertionError('Unexpected error while listing admin invites', { cause });
    }

    return {
        items: page.items.map((record) => presentInvite(record, createdByEmailsById)),
        cursor: page.cursor,
    };
}

// Resolves each distinct createdBy user id to an email address in one lookup
// per id, instead of once per invite, since many invites are often authored
// by the same admin.
async function getCreatedByEmailsById(context, adminUsers, records) {
    const ids = new Set(records.map((record) => record.get('createdBy')).filter(Boolean));
    const emailsById = new Map();

    await Promise.all(Array.from(ids).map(async (id) => {
        const user = await adminUsers.get(context, id);
        if (user) {
            // Project through toObject() rather than plucking get('emailAddress')
            // directly, so this call site automatically stays safe if AdminUser
            // ever grows another sensitive attribute alongside passwordHash.
            emailsById.set(id, user.toObject().emailAddress);
        }
    }));

    return emailsById;
}

// Falls back to the raw createdBy id when the authoring admin user has since
// been deleted, so the invite list still renders instead of showing blank.
function presentInvite(record, createdByEmailsById) {
    const createdBy = record.get('createdBy');
    return {
        id: record.id,
        kind: record.get('kind'),
        status: record.getStatus(),
        createdBy: createdByEmailsById.get(createdBy) ?? createdBy,
        createdAt: record.get('inviteCreationDate'),
        expiresAt: record.get('inviteExpirationDate'),
        consumedAt: record.get('consumedAt'),
        revokedAt: record.get('revokedAt'),
    };
}
