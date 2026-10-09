import { clearAdminSessionCookie } from '../lib/admin-session-cookie.js';
import isJsonPathRequest from '../lib/is-json-path-request.js';
import { renderHtmlErrorPage } from '../lib/html-error-page.js';


/**
 * Renders an error from the admin panel as an HTML page.
 *
 * An unauthenticated browser request is redirected to the login form rather than
 * shown an error page, and its session cookie is cleared on the way out so a
 * stale or revoked cookie cannot keep re-triggering the same failure.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {Error} error - Error being handled by the router cascade.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default|false>} Rendered response or login redirect, or false to continue the cascade for a JSON request.
 */
export default async function adminErrorHandler(context, request, response, error) {
    if (error.name === 'UnauthenticatedError' && !isJsonPathRequest(request)) {
        clearAdminSessionCookie(request, response);
        const loginTarget = context.getHttpTarget('admin-login-form/render-form');
        return response.respondWithRedirect(303, loginTarget.compilePathname().pathname);
    }

    return await renderHtmlErrorPage(context, request, response, error, {
        pathname: '/admin/errors',
        baseTemplateId: 'admin.html',
        scope: 'Admin',
    });
}
