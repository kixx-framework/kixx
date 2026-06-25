import NewAdminUserForm from '../forms/admin-users/new-admin-user-form.js';
import AdminUserLoginForm from '../forms/admin-users/admin-user-login-form.js';
import { createAdminUser } from '../../transaction-scripts/admin-users/create-admin-user.js';
import { authenticateAdminCredentials } from '../../transaction-scripts/admin-users/authenticate-admin-credentials.js';
import { setAdminSessionCookie } from '../../lib/user-sessions.js';
import {
    clearCsrfToken,
    getCsrfFormContext,
    validateCsrfFormData,
} from '../csrf.js';


const SESSION_CREATE_FAILED = 'session_create_failed';
const ALLOWED_LOGIN_NOTICES = new Set([ SESSION_CREATE_FAILED ]);

// Generic, non-enumerating message shown when admin login credentials are
// rejected. Mirrors the message from the authenticateAdminCredentials script so
// the unknown-email and wrong-password cases stay indistinguishable to the user.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';


function getAdminLoginFormLink(context) {
    const target = context.getHttpTarget('admin-login-form/render-form');
    return target.compilePathname().pathname;
}

function getNewAdminUserFormLink(context) {
    const target = context.getHttpTarget('new-admin-user-form/render-form');
    return target.compilePathname().pathname;
}

export async function getNewAdminUserForm(context, request, response) {
    const form = new NewAdminUserForm();
    return response.updateProps({
        form: await getCsrfFormContext(context, request, response, form),
        links: { loginForm: getAdminLoginFormLink(context) },
    });
}

export async function postNewAdminUserForm(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = NewAdminUserForm.fromFormData(formData);

    // Server-side validation. On failure, fall through to the page renderer with
    // field-level error state (skip() is intentionally not called).
    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            return response.updateProps({
                form: await getCsrfFormContext(context, request, response, form, error),
                links: { loginForm: getAdminLoginFormLink(context) },
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
                form: await getCsrfFormContext(context, request, response, form, error.code),
                links: { loginForm: getAdminLoginFormLink(context) },
                formError: 'An admin account with that email address already exists.',
            });
        }

        // The account was created but the session could not be established. Send
        // the user to the login page; that handler surfaces the notice code.
        if (error.code === 'SignupSessionFailed') {
            const newLocation = getAdminLoginFormLink(context);
            skip();
            return response.respondWithRedirect(303, `${ newLocation }?notice=${ SESSION_CREATE_FAILED }`);
        }

        throw error;
    }

    // Signup and session both succeeded: establish the session cookie and send the
    // now-authenticated admin into the admin panel.
    setAdminSessionCookie(request, response, result.sessionId);
    await clearCsrfToken(context, request, response);

    const adminTarget = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
    skip();
    return response.respondWithRedirect(303, adminTarget.compilePathname().pathname);
}

export async function getAdminUserLoginForm(context, request, response) {
    const form = new AdminUserLoginForm();
    const links = { newUserForm: getNewAdminUserFormLink(context) };

    // Reads an optional `notice` query parameter to surface post-redirect notices
    // (e.g. when signup completed but auto-login failed). Unknown notice codes are
    // silently discarded.
    const raw = request.queryParams.notice;
    const noticeCode = ALLOWED_LOGIN_NOTICES.has(raw) ? raw : null;

    return response.updateProps({
        form: await getCsrfFormContext(context, request, response, form, noticeCode),
        links,
    });
}

export async function postAdminUserLoginForm(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = AdminUserLoginForm.fromFormData(formData);
    const links = { newUserForm: getNewAdminUserFormLink(context) };

    // Server-side validation. On failure, fall through to the page renderer with
    // field-level error state (skip() is intentionally not called).
    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            return response.updateProps({
                form: await getCsrfFormContext(context, request, response, form, error),
                links,
            });
        }
        throw error;
    }

    let result;
    try {
        result = await authenticateAdminCredentials(context, form);
    } catch (error) {
        // Invalid credentials are an expected outcome the user can correct; re-render
        // with a single generic, non-enumerating message rather than a 401 page.
        if (error.code === 'InvalidCredentials') {
            return response.updateProps({
                form: await getCsrfFormContext(context, request, response, form),
                links,
                formError: INVALID_CREDENTIALS_MESSAGE,
            });
        }
        throw error;
    }

    // Credentials verified: establish the session cookie and send the
    // now-authenticated admin into the admin panel.
    setAdminSessionCookie(request, response, result.sessionId);
    await clearCsrfToken(context, request, response);

    const adminTarget = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
    skip();
    return response.respondWithRedirect(303, adminTarget.compilePathname().pathname);
}
