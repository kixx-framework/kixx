import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { ADMIN_SESSION_TTL_SECONDS } from '../../lib/admin-session.js';

export const ADMIN_SESSION_COOKIE_NAME = 'kixx_admin_session';


/**
 * Reports whether the request arrived over HTTPS, which decides the `Secure`
 * attribute on every cookie this application sets.
 *
 * Browsers silently drop a `Secure` cookie over plain HTTP, so setting it
 * unconditionally would break local development on http://localhost: the login
 * would appear to succeed while no session cookie is ever stored. Deriving the
 * flag from the request protocol keeps deployed environments secure without that
 * failure mode. Every cookie writer must use this single decision, so a session
 * cookie and its paired CSRF cookie can never disagree about being sent.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {boolean} True when the request URL protocol is `https:`.
 */
export function isSecureRequest(request) {
    return request.url.protocol === 'https:';
}

/**
 * Writes the admin session cookie that authenticates subsequent requests.
 *
 * The cookie is `Secure` only over HTTPS (see isSecureRequest), and its lifetime
 * matches the stored UserSession's, so the browser stops sending a cookie whose
 * session has already expired server-side.
 *
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {string} sessionId - Stored UserSession id to write into the cookie.
 * @returns {void}
 */
export function setAdminSessionCookie(request, response, sessionId) {
    response.setCookie(ADMIN_SESSION_COOKIE_NAME, sessionId, {
        path: '/',
        // Keep the cookie lifetime aligned with the stored UserSession expiration.
        maxAge: ADMIN_SESSION_TTL_SECONDS,
        secure: isSecureRequest(request),
    });
}

/**
 * Expires the admin session cookie in the browser.
 *
 * A no-op when the request carries no session cookie, so a logout or an error
 * handler can call it unconditionally. This only clears the browser's copy — the
 * stored UserSession must be deleted separately.
 *
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @returns {void}
 */
export function clearAdminSessionCookie(request, response) {
    const sessionId = request.getCookie(ADMIN_SESSION_COOKIE_NAME);

    if (!isNonEmptyString(sessionId)) {
        return;
    }

    response.setCookie(ADMIN_SESSION_COOKIE_NAME, '', {
        path: '/',
        maxAge: 0,
        secure: isSecureRequest(request),
    });
}
