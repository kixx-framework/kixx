import { getCsrfToken } from '../lib/csrf.js';


const RENDERING_METHODS = new Set([ 'GET', 'HEAD' ]);


/**
 * Adds the admin header's account props: who is logged in, and a logout form.
 *
 * Runs after authenticateAdminUser, so context.user is set. Only GET and HEAD
 * requests render pages; other methods skip minting a token they would never
 * show.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Current response state
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} Response carrying `adminAccount` props
 */
export default async function provideAdminLogoutForm(context, request, response) {
    if (!RENDERING_METHODS.has(request.method)) {
        return response;
    }

    const target = context.getHttpTarget('admin-logout/logout');

    return response.updateProps({
        adminAccount: {
            emailAddress: context.user.emailAddress,
            logoutForm: {
                url: target.compilePathname().pathname,
                csrf: await getCsrfToken(context, request, response),
            },
        },
    });
}
