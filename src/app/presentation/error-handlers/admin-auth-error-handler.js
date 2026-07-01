import { renderAdminErrorPage } from '../lib/admin-error-page.js';


/**
 * Renders the login-scope admin error page for HTML requests.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current server request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {Error} error - Error being handled by the router cascade.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>|false} Rendered response, or false for JSON requests.
 */
export function adminAuthErrorHandler(context, request, response, error) {
    return renderAdminErrorPage(context, request, response, error, '/login/admin/errors');
}
