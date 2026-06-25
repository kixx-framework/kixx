import NewAdminUserForm from '../forms/admin-users/new-admin-user-form.js';
import AdminUserLoginForm from '../forms/admin-users/admin-user-login-form.js';
import { createAdminUser } from '../../transaction-scripts/admin-users/create-admin-user.js';


const ALLOWED_LOGIN_NOTICES = new Set([ 'session_create_failed' ]);

// Session cookie shared with the (future) admin auth middleware. Changing this
// name requires updating wherever the session cookie is read on inbound requests.
const SESSION_COOKIE_NAME = 'kixx_admin_session';

// Mirror the session record TTL in create-admin-user.js so the browser drops the
// cookie at the same time the stored session expires (3 days).
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 3;


function buildNewUserLinks(context) {
    const loginTarget = context.getHttpTarget('admin-login-form/render-form');
    return { loginForm: loginTarget.compilePathname().pathname };
}

function setSessionCookie(request, response, sessionId) {
    // Secure cookies are dropped by browsers over plain HTTP, so only require it
    // when the request itself arrived over HTTPS. This keeps local development on
    // http://localhost working while staying secure in deployed environments.
    const isHttps = request.url.protocol === 'https:';

    response.setCookie(SESSION_COOKIE_NAME, sessionId, {
        path: '/',
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
        secure: isHttps,
    });
}

export function getNewAdminUserForm(context, _request, response) {
    const form = new NewAdminUserForm();
    return response.updateProps({
        form: form.getFormContext(context),
        links: buildNewUserLinks(context),
    });
}

/**
 * Handles the new-admin-user form submission: validates the payload, creates the
 * account and an authenticated session, then redirects into the admin area. On a
 * validation or duplicate-email failure it re-renders the form with error state.
 * @param {import('../../../kixx/context/request-context.js').default} context
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request
 * @param {import('../../../kixx/http-router/server-response.js').default} response
 * @param {function(): void} skip - Stops later middleware (the page renderer) from running.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>}
 */
export async function handleCreateAdminUser(context, request, response, skip) {
    const form = NewAdminUserForm.fromFormData(await request.formData());

    // Server-side validation. On failure, fall through to the page renderer with
    // field-level error state (skip() is intentionally not called).
    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            return response.updateProps({
                form: form.getFormContext(context, error),
                links: buildNewUserLinks(context),
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
                links: buildNewUserLinks(context),
                formError: 'An admin account with that email address already exists.',
            });
        }

        // The account was created but the session could not be established. Send
        // the user to the login page; that handler surfaces the notice code.
        if (error.code === 'SignupSessionFailed') {
            const loginTarget = context.getHttpTarget('admin-login-form/render-form');
            const { pathname } = loginTarget.compilePathname();
            skip();
            return response.respondWithRedirect(303, `${ pathname }?notice=session_create_failed`);
        }

        throw error;
    }

    // Signup and session both succeeded: establish the session cookie and send the
    // now-authenticated admin into the admin panel.
    setSessionCookie(request, response, result.sessionId);

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
