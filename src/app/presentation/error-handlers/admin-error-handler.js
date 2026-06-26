import { clearAdminSessionCookie } from '../lib/admin-session-cookie.js';


export function adminErrorHandler(context, request, response, error) {
    if (error.name !== 'UnauthenticatedError' || request.isJSONRequest()) {
        return false;
    }

    clearAdminSessionCookie(request, response);
    const loginTarget = context.getHttpTarget('admin-login-form/render-form');
    return response.respondWithRedirect(303, loginTarget.compilePathname().pathname);
}
