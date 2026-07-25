import NewAdminUserForm from '../forms/admin-users/new-admin-user-form.js';
import AdminUserLoginForm from '../forms/admin-users/admin-user-login-form.js';
import { createAdminUser } from '../../transaction-scripts/admin-users/create-admin-user.js';
import { resolveAdminInvite } from '../../transaction-scripts/admin-invites/resolve-admin-invite.js';
import { authenticateAdminCredentials } from '../../transaction-scripts/admin-users/authenticate-admin-credentials.js';
import { authenticateAdminSession } from '../../transaction-scripts/admin-users/authenticate-admin-session.js';
import {
    ADMIN_SESSION_COOKIE_NAME,
    setAdminSessionCookie,
} from '../lib/admin-session-cookie.js';
import {
    clearCsrfToken,
    getCsrfFormContext,
    validateCsrfFormData,
} from '../lib/csrf.js';
import {
    checkInviteThrottle,
    checkLoginThrottle,
    checkSignupThrottle,
    clearLoginThrottle,
    clearSignupThrottle,
    recordInviteGuess,
    recordLoginFailure,
    recordSignupFailure,
    throttleMessage,
} from '../lib/rate-limit.js';
import { isNonEmptyString } from '../../../kixx/assertions/mod.js';


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

async function hasValidAdminSession(context, request) {
    const sessionId = request.getCookie(ADMIN_SESSION_COOKIE_NAME);

    if (!isNonEmptyString(sessionId)) {
        return false;
    }

    try {
        await authenticateAdminSession(context, sessionId);
        return true;
    } catch (error) {
        if (error.name === 'UnauthenticatedError') {
            return false;
        }
        throw error;
    }
}

function renderAlreadyLoggedIn(response) {
    return response.updateProps({
        alreadyLoggedIn: true,
        inviteValid: false,
    });
}

// Renders the signup page in its "invalid invite" state: no form, just a notice
// and a link back to login. Used when the URL carries no redeemable invite, and
// when a token valid at GET time is spent, revoked, or expired before POST.
function renderInvalidInvite(context, response) {
    return response.updateProps({
        inviteValid: false,
        links: { loginForm: getAdminLoginFormLink(context) },
    });
}

// Renders the signup page in its throttled state: the no-form branch plus a
// "try again later" callout and a link back to login. Shared by the signup POST
// and the invite-bearing signup GET so both surfaces look identical when locked.
function renderSignupThrottled(context, response, retryAfterSeconds) {
    return response.updateProps({
        inviteValid: false,
        throttled: true,
        throttleMessage: throttleMessage(retryAfterSeconds),
        links: { loginForm: getAdminLoginFormLink(context) },
    });
}

export async function getNewAdminUserForm(context, request, response) {
    // A valid admin session makes invite signup ambiguous, so stop before token
    // lookup or throttle accounting and show the operator-facing remediation.
    if (await hasValidAdminSession(context, request)) {
        return renderAlreadyLoggedIn(response);
    }

    // Reject while this IP is locked out for invite guessing, before resolving
    // any token, so a guesser cannot keep probing the invite namespace.
    const throttle = await checkInviteThrottle(context, request);
    if (throttle.throttled) {
        return renderSignupThrottled(context, response, throttle.retryAfterSeconds);
    }

    // Signup is invite-only: without a redeemable invite (or matching bootstrap
    // token) there is no form to show. resolveAdminInvite is read-only — the token
    // is not spent until the POST succeeds.
    const inviteToken = request.queryParams.invite;
    const resolution = await resolveAdminInvite(context, inviteToken);

    if (!resolution.redeemable) {
        // Count only a token that matched no known invite — the brute-force
        // signal. A tokenless visit, or an expired/spent/revoked real invite
        // (which still resolves to a stored record), is not a guess and must not
        // advance the counter, so legitimate users and aged links aren't punished.
        if (isNonEmptyString(inviteToken) && resolution.record === null) {
            await recordInviteGuess(context, request);
        }
        return renderInvalidInvite(context, response);
    }

    const form = new NewAdminUserForm({ invite_token: inviteToken });
    return response.updateProps({
        inviteValid: true,
        form: await getCsrfFormContext(context, request, response, form),
        links: { loginForm: getAdminLoginFormLink(context) },
    });
}

export async function postNewAdminUserForm(context, request, response, skip) {
    // Do not parse, validate, or consume invite data from a browser that already
    // has a valid admin session.
    if (await hasValidAdminSession(context, request)) {
        return renderAlreadyLoggedIn(response);
    }

    // Reject before parsing the body or touching the invite when this IP is
    // already locked out, so abusive submissions cost nothing past the IP read.
    const throttle = await checkSignupThrottle(context, request);
    if (throttle.throttled) {
        return renderSignupThrottled(context, response, throttle.retryAfterSeconds);
    }

    const formData = await validateCsrfFormData(context, request);
    const form = NewAdminUserForm.fromFormData(formData);

    // Check invite redeemability before field validation so a missing, expired,
    // revoked, or already-spent invite cannot re-render the account form just
    // because another submitted field is invalid. This read is intentionally
    // non-mutating; createAdminUser still consumes the invite after validation.
    const resolution = await resolveAdminInvite(context, form.invite_token);
    if (!resolution.redeemable) {
        await recordSignupFailure(context, request);
        return renderInvalidInvite(context, response);
    }

    // Server-side validation. On failure, fall through to the page renderer with
    // field-level error state (skip() is intentionally not called). The form
    // carries the hidden invite_token, so the re-rendered form keeps the invite.
    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            await recordSignupFailure(context, request);
            // This inline re-render owns its status: a field-invalid submission is
            // a 422, not the default 200, even though the page renders normally.
            response.status = error.httpStatusCode || 500;
            return response.updateProps({
                inviteValid: true,
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
        // the invite is not consumed on this path, so re-render the form to retry.
        if (error.code === 'NewUserConflictError') {
            await recordSignupFailure(context, request);
            // The duplicate-email conflict is openly reported in the body (this
            // invite-gated flow does not hide account existence), so the status
            // matches the outcome: a 409, not the default 200.
            response.status = error.httpStatusCode || 500;
            return response.updateProps({
                inviteValid: true,
                form: await getCsrfFormContext(context, request, response, form, error.code),
                links: { loginForm: getAdminLoginFormLink(context) },
                formError: 'An admin account with that email address already exists.',
            });
        }

        // The invite was redeemable when the page loaded but was spent, revoked, or
        // expired before this submission. Show the invalid-invite state.
        if (error.code === 'InvalidInvite') {
            await recordSignupFailure(context, request);
            return renderInvalidInvite(context, response);
        }

        // The account was created but the session could not be established. Send
        // the user to the login page; that handler surfaces the notice code. This
        // is not a signup-abuse failure (the account exists), so it is not counted.
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
    // A completed signup clears the per-IP counter so a legitimate user isn't
    // penalized by their own earlier validation stumbles.
    await clearSignupThrottle(context, request);
    await clearCsrfToken(context, request, response);

    const adminTarget = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
    skip();
    return response.respondWithRedirect(303, adminTarget.compilePathname().pathname);
}

export async function getAdminUserLoginForm(context, request, response) {
    const form = new AdminUserLoginForm();

    // Reads an optional `notice` query parameter to surface post-redirect notices
    // (e.g. when signup completed but auto-login failed). Unknown notice codes are
    // silently discarded.
    const raw = request.queryParams.notice;
    const noticeCode = ALLOWED_LOGIN_NOTICES.has(raw) ? raw : null;

    return response.updateProps({
        form: await getCsrfFormContext(context, request, response, form, noticeCode),
    });
}

// Re-renders the login form in its throttled state: a fresh CSRF token plus a
// non-enumerating "try again later" callout. Used both for the pre-auth check
// and when a failed attempt is the one that trips the lock.
async function renderLoginThrottled(context, request, response, form, retryAfterSeconds) {
    return response.updateProps({
        form: await getCsrfFormContext(context, request, response, form),
        throttled: true,
        throttleMessage: throttleMessage(retryAfterSeconds),
    });
}

export async function postAdminUserLoginForm(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = AdminUserLoginForm.fromFormData(formData);

    // Reject before attempting authentication when this IP or this (IP, email)
    // pair is already locked out, so a throttled attacker cannot keep probing.
    const throttle = await checkLoginThrottle(context, request, form.email_address);
    if (throttle.throttled) {
        return renderLoginThrottled(context, request, response, form, throttle.retryAfterSeconds);
    }

    // Server-side validation. On failure, fall through to the page renderer with
    // field-level error state (skip() is intentionally not called).
    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            // A missing/malformed field is a 422, not the default 200. This is a
            // shape error, distinct from the deliberately-200 invalid-credentials
            // and throttled branches below, which must not leak an outcome signal.
            response.status = error.httpStatusCode || 500;
            return response.updateProps({
                form: await getCsrfFormContext(context, request, response, form, error),
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
            // Count this failure first; if it tripped the lock, show the throttle
            // message instead of the credential message so neither response leaks
            // which input was wrong.
            const state = await recordLoginFailure(context, request, form.email_address);
            if (state.throttled) {
                return renderLoginThrottled(context, request, response, form, state.retryAfterSeconds);
            }
            return response.updateProps({
                form: await getCsrfFormContext(context, request, response, form),
                formError: INVALID_CREDENTIALS_MESSAGE,
            });
        }
        throw error;
    }

    // Credentials verified: establish the session cookie and send the
    // now-authenticated admin into the admin panel.
    setAdminSessionCookie(request, response, result.sessionId);
    // A clean login clears the throttle so earlier failures don't haunt the user.
    await clearLoginThrottle(context, request, form.email_address);
    await clearCsrfToken(context, request, response);

    const adminTarget = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
    skip();
    return response.respondWithRedirect(303, adminTarget.compilePathname().pathname);
}
