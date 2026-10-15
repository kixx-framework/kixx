import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Deletes a stored admin session so its cookie no longer authenticates.
 *
 * A missing, expired, or already-deleted session is not an error: the browser
 * ends up logged out either way.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context
 * @param {string|null} sessionId - UserSession record id read from the admin session cookie
 * @returns {Promise<void>}
 * @throws {AssertionError} When an unexpected storage failure occurs while deleting the session
 */
export async function endAdminSession(context, sessionId) {
    if (!isNonEmptyString(sessionId)) {
        return;
    }

    const sessions = context.getCollection('UserSession');

    try {
        await sessions.delete(context, sessionId);
    } catch (cause) {
        throw new AssertionError('Unexpected error while deleting an admin session', { cause });
    }
}
