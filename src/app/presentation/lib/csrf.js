import { ForbiddenError } from '../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { generateSecretToken } from '../../../kixx/utils/crypto.js';
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
 * The token is a stateless HMAC envelope binding the browser's `sid` cookie
 * value and an expiration, verified without any storage lookup. The token is
 * new on every render, but the `sid` is not: the cookie is browser-wide, so
 * replacing it would silently invalidate the forms every other open tab is
 * holding. See `mintCsrfToken()`.
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
    const { sid, token } = await mintCsrfToken(context, request);

    // Refresh the cookie on every render with the full TTL so it always
    // outlives a token minted in this same response; the sid itself is not a
    // credential; without the signing secret it cannot be turned into a token.
    response.setCookie(CSRF_COOKIE_NAME, sid, {
        path: '/',
        maxAge: CSRF_TOKEN_TTL_SECONDS,
        secure: isSecureRequest(request),
        httpOnly: true,
        sameSite: 'Lax',
    });

    return Object.assign({}, formContext, {
        csrf: {
            fieldName: CSRF_FIELD_NAME,
            token,
        },
    });
}

/**
 * Re-renders a page whose submission was rejected, with a fresh CSRF token.
 *
 * Rejecting a submission does not end the interaction: an expired form and a
 * failed field validation are both mistakes the user can correct, so the page
 * comes back with its data intact rather than being replaced by an error page.
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

// Reuses the browser's existing sid when the cookie carries one, and mints a
// new one otherwise. Reusing sid is what keeps a second tab (or a reload)
// from invalidating forms already on screen: every render signs a fresh
// token, but all of them verify against the same sid until the cookie is
// cleared or the secret rotates.
async function mintCsrfToken(context, request) {
    const signer = context.getService('CsrfTokenSigner');
    const existingSid = request.getCookie(CSRF_COOKIE_NAME);
    const sid = isNonEmptyString(existingSid) ? existingSid : generateSecretToken();
    const token = await signer.sign(sid, CSRF_TOKEN_TTL_SECONDS);

    return { sid, token };
}

/**
 * Reads submitted form data and validates its CSRF token before callers construct a Form.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<FormData>} Parsed form data after CSRF validation succeeds.
 * @throws {ForbiddenError} When the CSRF cookie or submitted token is missing, forged, expired, or bound to a different sid.
 */
export async function validateCsrfFormData(context, request) {
    const formData = await request.formData();
    const sid = request.getCookie(CSRF_COOKIE_NAME);
    const token = formData.get(CSRF_FIELD_NAME);
    const signer = context.getService('CsrfTokenSigner');

    const isValidToken = isNonEmptyString(sid)
        && isNonEmptyString(token)
        && await signer.verify(token, sid);

    if (!isValidToken) {
        throw new ForbiddenError('The form has expired. Please reload and try again.', {
            code: INVALID_CSRF_TOKEN_CODE,
        });
    }

    return formData;
}

/**
 * Clears the browser's CSRF cookie.
 *
 * Unlike a stored pre-session, there is nothing server-side to delete: the
 * token's validity lives entirely in its signature, so clearing the cookie
 * only removes the sid the browser would otherwise keep resubmitting for
 * reuse. This is deliberate at the login and signup boundary: the CSRF cookie
 * has served its purpose once a real session exists.
 *
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response being built.
 * @returns {void}
 */
export function clearCsrfToken(request, response) {
    response.setCookie(CSRF_COOKIE_NAME, '', {
        path: '/',
        maxAge: 0,
        secure: isSecureRequest(request),
        httpOnly: true,
        sameSite: 'Lax',
    });
}
