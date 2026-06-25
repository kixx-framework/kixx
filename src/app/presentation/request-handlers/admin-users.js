import NewAdminUserForm from '../forms/admin-users/new-admin-user-form.js';
import AdminUserLoginForm from '../forms/admin-users/admin-user-login-form.js';
import { createAdminUser } from '../../transaction-scripts/admin-users/create-admin-user.js';
import { setAdminSessionCookie } from '../../lib/user-sessions.js';


const SESSION_CREATE_FAILED = 'session_create_failed';
const ALLOWED_LOGIN_NOTICES = new Set([ SESSION_CREATE_FAILED ]);


function getNewAdminUserFormLink(context) {
    const target = context.getHttpTarget('admin-login-form/render-form');
    return target.compilePathname().pathname;
}

function getAdminUserLoginFormLink(context) {
    const target = context.getHttpTarget('new-admin-user-form/render-form');
    return target.compilePathname().pathname;
}

export function getNewAdminUserForm(context, _request, response) {
    const form = new NewAdminUserForm();
    return response.updateProps({
        form: form.getFormContext(context),
        links: { loginForm: getNewAdminUserFormLink(context) },
    });
}

export async function postNewAdminUserForm(context, request, response, skip) {
    const form = NewAdminUserForm.fromFormData(await request.formData());

    // Server-side validation. On failure, fall through to the page renderer with
    // field-level error state (skip() is intentionally not called).
    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            return response.updateProps({
                form: form.getFormContext(context, error),
                links: { loginForm: getNewAdminUserFormLink(context) },
            });
        }
        throw error;
    }

    let result;
    try {
        result = await createAdminUser(context, form);
    } catch (error) {
        // A duplicate email address is an expected outcome the user can correct;
        // re-render the form with a form-level message rather than a 409 page.
        if (error.code === 'NewUserConflictError') {
            return response.updateProps({
                form: form.getFormContext(context, error.code),
                links: { loginForm: getNewAdminUserFormLink(context) },
                formError: 'An admin account with that email address already exists.',
            });
        }

        // The account was created but the session could not be established. Send
        // the user to the login page; that handler surfaces the notice code.
        if (error.code === 'SignupSessionFailed') {
            const newLocation = getAdminUserLoginFormLink(context);
            skip();
            return response.respondWithRedirect(303, `${ newLocation }?notice=${ SESSION_CREATE_FAILED }`);
        }

        throw error;
    }

    // Signup and session both succeeded: establish the session cookie and send the
    // now-authenticated admin into the admin panel.
    setAdminSessionCookie(request, response, result.sessionId);

    const adminTarget = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
    skip();
    return response.respondWithRedirect(303, adminTarget.compilePathname().pathname);
}

export function getAdminUserLoginForm(context, request, response) {
    const form = new AdminUserLoginForm();
    const newUserTarget = context.getHttpTarget('new-admin-user-form/render-form');
    const links = { newUserForm: newUserTarget.compilePathname().pathname };

    // Reads an optional `notice` query parameter to surface post-redirect notices
    // (e.g. when signup completed but auto-login failed). Unknown notice codes are
    // silently discarded.
    const raw = request.queryParams.notice;
    const noticeCode = ALLOWED_LOGIN_NOTICES.has(raw) ? raw : null;

    return response.updateProps({ form: form.getFormContext(context, noticeCode), links });
}
