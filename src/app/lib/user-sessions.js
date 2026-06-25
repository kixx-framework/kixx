import { isNonEmptyString } from '../../kixx/assertions/mod.js';

// Shared by admin signup, login, and authentication middleware. Keep the cookie
// lifetime aligned with the stored UserSession expiration.
export const ADMIN_SESSION_COOKIE_NAME = 'kixx_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 3;


export function setAdminSessionCookie(request, response, sessionId) {
    // Secure cookies are dropped by browsers over plain HTTP, so only require it
    // when the request itself arrived over HTTPS. This keeps local development on
    // http://localhost working while staying secure in deployed environments.
    const isHttps = request.url.protocol === 'https:';

    response.setCookie(ADMIN_SESSION_COOKIE_NAME, sessionId, {
        path: '/',
        maxAge: ADMIN_SESSION_TTL_SECONDS,
        secure: isHttps,
    });
}

export function clearAdminSessionCookie(request, response) {
    const sessionId = request.getCookie(ADMIN_SESSION_COOKIE_NAME);

    if (!isNonEmptyString(sessionId)) {
        return;
    }

    // Match the signup cookie's Secure behavior so local HTTP development can
    // also clear stale session cookies.
    const isHttps = request.url.protocol === 'https:';

    response.setCookie(ADMIN_SESSION_COOKIE_NAME, '', {
        path: '/',
        maxAge: 0,
        secure: isHttps,
    });
}
