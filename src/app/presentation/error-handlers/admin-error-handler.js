import { clearAdminSessionCookie } from '../lib/admin-session-cookie.js';
import { renderHtmlErrorPage } from '../lib/html-error-page.js';


export function adminErrorHandler(context, request, response, error) {
    if (error.name === 'UnauthenticatedError' && !request.isJSONRequest()) {
        clearAdminSessionCookie(request, response);
        const loginTarget = context.getHttpTarget('admin-login-form/render-form');
        return response.respondWithRedirect(303, loginTarget.compilePathname().pathname);
    }

    return renderHtmlErrorPage(context, request, response, error, '/admin/errors', 'Admin');
}
