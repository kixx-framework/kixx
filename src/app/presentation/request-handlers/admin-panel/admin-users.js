import NewAdminUserForm from '../../forms/admin-users/new-admin-user-form.js';
import AdminUserLoginForm from '../../forms/admin-users/admin-user-login-form.js';
import { createAdminUser } from '../../../transaction-scripts/admin-users/create-admin-user.js';
import { resolveAdminInvite } from '../../../transaction-scripts/admin-invites/resolve-admin-invite.js';
import { authenticateAdminCredentials } from '../../../transaction-scripts/admin-users/authenticate-admin-credentials.js';
import { authenticateAdminSession } from '../../../transaction-scripts/admin-users/authenticate-admin-session.js';
import {
    ADMIN_SESSION_COOKIE_NAME,
    setAdminSessionCookie,
} from '../../lib/admin-session-cookie.js';
import {
    clearCsrfToken,
    getCsrfFormContext,
    validateCsrfFormData,
} from '../../lib/csrf.js';
import {
    checkInviteThrottle,
    checkLoginThrottle,
    checkSignupSubmissionThrottle,
    clearLoginThrottle,
    clearSignupThrottle,
    recordInviteGuess,
    recordLoginFailure,
    recordSignupFailure,
    throttleMessage,
} from '../../lib/rate-limit.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';


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

function getAdminPanelLink(context) {
    const target = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
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

// Renders the signup page in its "invite spent by a race" state: the no-form
// branch with a message that names what happened. Distinct from renderInvalidInvite
// because the invitee did nothing wrong and their link was genuinely valid — the
// only recovery is a new invite, and saying so is what stops them from retrying
// into the indistinguishable "invalid invite" wall.
function renderInviteSpentByRace(context, response) {
    return response.updateProps({
        inviteValid: false,
        inviteSpentByRace: true,
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

/**
 * Renders the invite-gated admin signup form.
 *
 * Signup is invite-only: without a redeemable `invite` query parameter there is
 * no form to show. The invite is only resolved, never spent — the token is
 * consumed by the POST. Per-IP throttling is checked before any token lookup, and
 * only a token matching no stored invite advances the guess counter, so an aged
 * or already-used real invite does not penalize a legitimate visitor.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the signup form, or an invalid-invite, throttled, or already-logged-in state.
 */
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

/**
 * Redeems an invite, creates the admin account, and signs the new user in.
 *
 * The invite is checked for redeemability before field validation, so an invalid
 * field cannot re-render the form on an invite that is already spent. Every
 * recoverable outcome — invalid fields, a duplicate email, an invite spent by a
 * concurrent signup — re-renders with its own honest status rather than the
 * default 200. On success the session cookie is set and the CSRF pre-session is
 * dropped, and the response is a redirect so a refresh cannot resubmit.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so the Hyperview page handler does not render over the redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect into the admin panel, or a re-rendered form carrying the failure state.
 * @throws {ForbiddenError} When CSRF validation fails.
 */
export async function postNewAdminUserForm(context, request, response, skip) {
    // Do not parse, validate, or consume invite data from a browser that already
    // has a valid admin session.
    if (await hasValidAdminSession(context, request)) {
        return renderAlreadyLoggedIn(response);
    }

    // Reject before parsing the body or touching the invite when this IP is
    // already locked out, so abusive submissions cost nothing past the IP read.
    // This submission carries an invite token and exposes the same valid/invalid
    // distinction as the GET, so the strict invite lock applies here as well as
    // the looser signup lock; otherwise a guesser locked out of GET could keep
    // probing through POST.
    const throttle = await checkSignupSubmissionThrottle(context, request);
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
        // Mirrors the GET: a token that matched no known invite is a guess and
        // must advance the strict invite counter too. A tokenless submission, or
        // a real invite that is expired/spent/revoked (which still resolves to a
        // stored record), is not a guess and only counts as a signup failure.
        if (isNonEmptyString(form.invite_token) && resolution.record === null) {
            await recordInviteGuess(context, request);
        }
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
            response.status = 422;
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
        // A concurrent signup took the email address after this request had
        // already spent the invite. There is nothing to retry — the token is
        // gone — so show the no-form explanation instead of a live form. Not
        // counted as a signup failure: this is a collision the user could not
        // have avoided, and there is no follow-up attempt left to throttle.
        if (error.code === 'InviteSpentInEmailRace') {
            // The conflict is openly reported in the body, so the status matches
            // the outcome: a 409, not the default 200.
            response.status = 409;
            return renderInviteSpentByRace(context, response);
        }

        // A duplicate email address is an expected outcome the user can correct;
        // the invite is not consumed on this path, so re-render the form to retry.
        if (error.code === 'NewUserConflictError') {
            await recordSignupFailure(context, request);
            // The duplicate-email conflict is openly reported in the body (this
            // invite-gated flow does not hide account existence), so the status
            // matches the outcome: a 409, not the default 200.
            response.status = 409;
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
    clearCsrfToken(request, response);

    const adminTarget = context.getHttpTarget('admin-panel/style-guide/render-style-guide-page');
    skip();
    return response.respondWithRedirect(303, adminTarget.compilePathname().pathname);
}

/**
 * Renders the admin login form.
 *
 * A request carrying a valid admin session is redirected to the admin panel with
 * a 302 before form or CSRF state is created. Missing and invalid sessions proceed
 * to the login form normally.
 *
 * An unrecognized `notice` query parameter is discarded rather than echoed, so a
 * post-redirect notice cannot inject arbitrary text into the page.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so the Hyperview page handler does not render over the redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 302 redirect for an authenticated admin, or a response carrying the login form and any recognized notice.
 */
export async function getAdminUserLoginForm(context, request, response, skip) {
    // An authenticated browser has no login work to perform. Check before
    // interpreting notices or creating CSRF state, and leave all auth state intact.
    if (await hasValidAdminSession(context, request)) {
        skip();
        return response.respondWithRedirect(302, getAdminPanelLink(context));
    }

    const form = new AdminUserLoginForm();

    // Reads an optional `notice` query parameter to surface post-redirect notices
    // (e.g. when signup completed but auto-login failed). Unknown notice codes are
    // silently discarded.
    const raw = request.queryParams.notice;
    const noticeCode = ALLOWED_LOGIN_NOTICES.has(raw) ? raw : null;

    const newForm = await getCsrfFormContext(context, request, response, form, noticeCode);
    return response.updateProps({ form: newForm });
}

// Re-renders the login form in its throttled state: a fresh CSRF token plus a
// non-enumerating "try again later" callout. Used both for the pre-auth check
// and when a failed attempt is the one that trips the lock.
async function renderLoginThrottled(context, request, response, form, retryAfterSeconds) {
    const newForm = await getCsrfFormContext(context, request, response, form);
    return response.updateProps({
        form: newForm,
        throttled: true,
        throttleMessage: throttleMessage(retryAfterSeconds),
    });
}

/**
 * Authenticates admin credentials and establishes a session.
 *
 * A request carrying a valid admin session is redirected to the admin panel with
 * a 303 before its body is parsed or any CSRF, throttle, credential, or session
 * state is read or changed. Missing and invalid sessions proceed normally.
 *
 * Invalid credentials and throttled attempts both re-render with a single generic
 * message and a deliberate 200, so neither response reveals whether an account
 * exists; only a malformed submission reports a distinguishable 422. Failures are
 * counted per IP and per (IP, email) before the response is chosen, so the attempt
 * that trips the lock already shows the throttled state. On success the session
 * cookie is set and the CSRF pre-session is dropped.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so the Hyperview page handler does not render over the redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect into the admin panel, or a re-rendered form carrying the failure state.
 * @throws {ForbiddenError} When CSRF validation fails.
 */
export async function postAdminUserLoginForm(context, request, response, skip) {
    // Do not parse credentials or mutate login state for a browser that already
    // has a valid session. Replacing it would also leave the prior session alive.
    if (await hasValidAdminSession(context, request)) {
        skip();
        return response.respondWithRedirect(303, getAdminPanelLink(context));
    }

    const formData = await validateCsrfFormData(context, request);
    const form = AdminUserLoginForm.fromFormData(formData);

    // Reject before attempting authentication when this IP or this (IP, email)
    // pair is already locked out, so a throttled attacker cannot keep probing.
    const throttle = await checkLoginThrottle(context, request, form.email_address);
    if (throttle.throttled) {
        return await renderLoginThrottled(context, request, response, form, throttle.retryAfterSeconds);
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
            response.status = 422;
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
                return await renderLoginThrottled(context, request, response, form, state.retryAfterSeconds);
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
    clearCsrfToken(request, response);

    skip();
    return response.respondWithRedirect(303, getAdminPanelLink(context));
}
