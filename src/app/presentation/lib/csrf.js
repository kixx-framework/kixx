import { ForbiddenError } from '../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { isSecureRequest } from './admin-session-cookie.js';


export const CSRF_COOKIE_NAME = 'kixx_csrf_session';
export const CSRF_FIELD_NAME = 'csrf_token';
export const CSRF_TOKEN_TTL_SECONDS = 60 * 30;

// The `code` validateCsrfFormData() reports an expired or mismatched token with.
// Handlers that can recover — by re-rendering their page with a fresh token, or
// by redirecting with a notice — match on this to separate a stale form from a
// real access-control failure. Left uncaught it reaches adminErrorHandler, which
// replaces the whole page with a generic 403 "Access denied".
export const INVALID_CSRF_TOKEN_CODE = 'InvalidCsrfTokenError';


/**
 * A form render context carrying the hidden CSRF field the template must emit.
 * Without the `csrf` property the rendered form cannot be submitted, because
 * validateCsrfFormData() rejects a submission with no token.
 *
 * @typedef {import('../forms/base-form.js').FormRenderContext & {csrf: {fieldName: string, token: string}}} CsrfFormRenderContext
 */

/**
 * Builds a form render context with a fresh synchronizer CSRF token.
 *
 * The token is new on every render, but the browser's pre-session is not: the
 * cookie is browser-wide, so replacing the pre-session would silently kill the
 * forms every other open tab is holding. See `issueCsrfToken()`.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response being built.
 * @param {import('../forms/base-form.js').default} form - Form instance to render.
 * @param {import('../../../kixx/errors/lib/validation-error.js').default|string|null} [error] - Optional validation or domain error.
 * @returns {Promise<CsrfFormRenderContext>} Form context including `csrf.fieldName` and `csrf.token`.
 */
export async function getCsrfFormContext(context, request, response, form, error) {
    const formContext = form.getFormContext(context, error);
    const { csrf, maxAge } = await issueCsrfToken(context, request);

    response.setCookie(CSRF_COOKIE_NAME, csrf.csrfSessionId, {
        path: '/',
        // Track the pre-session's own remaining lifetime rather than restating the
        // full TTL: reuse does not extend the deadline, so a cookie carrying the
        // full TTL would outlive the record it names.
        maxAge,
        secure: isSecureRequest(request),
        httpOnly: true,
        sameSite: 'Lax',
    });

    return Object.assign({}, formContext, {
        csrf: {
            fieldName: CSRF_FIELD_NAME,
            token: csrf.token,
        },
    });
}

/**
 * Re-renders a page whose submission was rejected, with a fresh CSRF token.
 *
 * Rejecting a submission does not end the interaction: an expired form and a
 * failed field validation are both mistakes the user can correct, so the page
 * comes back with its data intact rather than being replaced by an error page.
 * The re-render must carry a new token, because validateCsrfFormData() spends the
 * submitted one — without this the corrected resubmission would be rejected too,
 * trapping the user in a loop.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response being built.
 * @param {object} options - Render options.
 * @param {import('../forms/base-form.js').default} options.form - Form instance to re-render.
 * @param {Object} options.props - Page props to render alongside the form.
 * @param {Error|string} [options.error] - Validation error, or a notice code for the template.
 * @param {number} [options.status] - Response status; required when `error` is a notice code.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} The updated response.
 */
export async function renderWithFreshCsrf(context, request, response, { form, props, error, status }) {
    // A notice code carries no status of its own, so callers recovering from a
    // rejected submission pass the caught error's status explicitly. The response
    // keeps reporting the rejection honestly even though the page renders.
    response.status = status || error?.httpStatusCode || 500;

    return response.updateProps(Object.assign({}, props, {
        form: await getCsrfFormContext(context, request, response, form, error),
    }));
}

// Mints this render's token into the browser's existing pre-session when one is
// still live, and starts a new pre-session otherwise. Reusing the record is what
// keeps a second tab (or a reload) from invalidating forms already on screen;
// each render still gets its own single-use token, so nothing is shared between
// pages beyond the pre-session itself.
async function issueCsrfToken(context, request) {
    const csrfTokens = context.getCollection('CsrfToken');
    const csrfSessionId = request.getCookie(CSRF_COOKIE_NAME);

    if (isNonEmptyString(csrfSessionId)) {
        const record = await csrfTokens.getBySessionId(context, csrfSessionId);

        // A record can outlive its store TTL by a moment, so the embedded deadline
        // is checked too; a pre-session is replaced rather than extended once it is
        // spent. The threshold is remaining lifetime, not expiry: a pre-session in
        // its final moments cannot be written to, and a token minted into it would
        // die before the form it belongs to could be filled in.
        if (record && record.isReusable()) {
            const csrf = await csrfTokens.issueToken(context, record);
            return { csrf, maxAge: record.getSecondsUntilExpiration() };
        }
    }

    const csrf = await csrfTokens.createToken(context, CSRF_TOKEN_TTL_SECONDS);
    return { csrf, maxAge: CSRF_TOKEN_TTL_SECONDS };
}

/**
 * Reads submitted form data and validates its CSRF token before callers construct a Form.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<FormData>} Parsed form data after CSRF validation succeeds.
 * @throws {ForbiddenError} When the CSRF cookie or submitted token is missing, expired, or mismatched.
 */
export async function validateCsrfFormData(context, request) {
    const formData = await request.formData();
    const csrfSessionId = request.getCookie(CSRF_COOKIE_NAME);
    const token = formData.get(CSRF_FIELD_NAME);
    const csrfTokens = context.getCollection('CsrfToken');
    const isValidToken = await csrfTokens.validateToken(context, csrfSessionId, token);

    if (!isValidToken) {
        throw new ForbiddenError('The form has expired. Please reload and try again.', {
            code: INVALID_CSRF_TOKEN_CODE,
        });
    }

    // Consume the submitted token immediately so it cannot be replayed in a
    // concurrent or retried request. Only this token is spent — the pre-session
    // and the tokens other open pages are holding survive. If the handler later
    // re-renders the form (e.g. on validation failure), getCsrfFormContext mints
    // a new token into the same pre-session.
    await csrfTokens.consumeToken(context, csrfSessionId, token);

    return formData;
}

/**
 * Deletes the current CSRF pre-session and clears its browser cookie.
 *
 * Unlike consuming a single token, this drops every token the browser holds. That
 * is deliberate at the login and signup boundary: the pre-session has served its
 * purpose once a real session exists, and any pre-auth form still open should not
 * remain submittable.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response being built.
 * @returns {Promise<void>}
 */
export async function clearCsrfToken(context, request, response) {
    const csrfSessionId = request.getCookie(CSRF_COOKIE_NAME);

    if (isNonEmptyString(csrfSessionId)) {
        const csrfTokens = context.getCollection('CsrfToken');
        await csrfTokens.deleteToken(context, csrfSessionId);
    }

    response.setCookie(CSRF_COOKIE_NAME, '', {
        path: '/',
        maxAge: 0,
        secure: isSecureRequest(request),
        httpOnly: true,
        sameSite: 'Lax',
    });
}
