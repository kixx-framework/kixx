import { renderHtmlErrorPage } from '../lib/html-error-page.js';

/**
 * Renders an error from the admin login and signup routes as an HTML page.
 *
 * Unlike adminErrorHandler, this does not redirect an unauthenticated request to
 * the login form: these routes are the login form, so redirecting would loop.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {Error} error - Error being handled by the router cascade.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default|false>} Rendered response, or false to continue the cascade for a JSON request.
 */
export default async function adminAuthErrorHandler(context, request, response, error) {
    return await renderHtmlErrorPage(context, request, response, error, '/login/admin/errors', 'Admin');
}
