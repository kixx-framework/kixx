import { isNonEmptyString, isValidDate } from '../../../kixx/assertions/mod.js';
import { AssertionError, UnauthenticatedError } from '../../../kixx/errors/mod.js';


const UNAUTHENTICATED_MESSAGE = 'Admin authentication is required.';


function createUnauthenticatedError(options) {
    return new UnauthenticatedError(UNAUTHENTICATED_MESSAGE, options);
}

function isSessionExpired(session) {
    const expirationDate = new Date(session.get('sessionExpirationDate'));
    return !isValidDate(expirationDate) || expirationDate.getTime() <= Date.now();
}

/**
 * Authenticates an admin user from a stored session id.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context
 * @param {string} sessionId - UserSession record id read from the admin session cookie
 * @returns {Promise<{ id: string, type: string, emailAddress: string, userCreationDate: string }>} Safe authenticated-user object
 * @throws {UnauthenticatedError} When the session is missing, expired, invalid, or orphaned
 * @throws {AssertionError} When an unexpected storage failure occurs while loading authentication records
 */
export async function authenticateAdminSession(context, sessionId) {
    if (!isNonEmptyString(sessionId)) {
        throw createUnauthenticatedError();
    }

    const sessions = context.getCollection('UserSession');
    const adminUsers = context.getCollection('AdminUser');

    let session;
    try {
        session = await sessions.get(context, sessionId);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin session', { cause });
    }

    if (!session || isSessionExpired(session)) {
        throw createUnauthenticatedError();
    }

    const userId = session.get('userId');
    if (!isNonEmptyString(userId)) {
        throw createUnauthenticatedError();
    }

    let user;
    try {
        user = await adminUsers.get(context, userId);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin user for session authentication', { cause });
    }

    if (!user) {
        throw createUnauthenticatedError();
    }

    return user.toAuthenticatedUser();
}
