import { ForbiddenError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';


export const CSRF_COOKIE_NAME = 'kixx_csrf_session';
export const CSRF_FIELD_NAME = 'csrf_token';
export const CSRF_TOKEN_TTL_SECONDS = 60 * 30;


/**
 * Builds a form render context with a fresh synchronizer CSRF token.
 * @param {import('../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../kixx/http-router/server-response.js').default} response - Response being built.
 * @param {import('./forms/base-form.js').default} form - Form instance to render.
 * @param {import('../../kixx/errors/lib/validation-error.js').default|string|null} [error] - Optional validation or domain error.
 * @returns {Promise<Object>} Form context including `csrf.fieldName` and `csrf.token`.
 */
export async function getCsrfFormContext(context, request, response, form, error) {
    const formContext = form.getFormContext(context, error);
    const csrfTokens = context.getCollection('CsrfToken');
    const previousCsrfSessionId = request.getCookie(CSRF_COOKIE_NAME);

    if (isNonEmptyString(previousCsrfSessionId)) {
        await csrfTokens.deleteToken(context, previousCsrfSessionId);
    }

    const csrf = await csrfTokens.createToken(context, CSRF_TOKEN_TTL_SECONDS);

    response.setCookie(CSRF_COOKIE_NAME, csrf.csrfSessionId, {
        path: '/',
        maxAge: CSRF_TOKEN_TTL_SECONDS,
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
 * Reads submitted form data and validates its CSRF token before callers construct a Form.
 * @param {import('../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
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
            code: 'InvalidCsrfTokenError',
        });
    }

    // Consume the token immediately so the same CSRF session cannot be replayed
    // in a concurrent or retried request. If the handler later re-renders the
    // form (e.g. on validation failure), getCsrfFormContext will issue a fresh
    // token and tolerate this deletion because KV delete is a no-op on absent keys.
    await csrfTokens.deleteToken(context, csrfSessionId);

    return formData;
}

/**
 * Deletes the current CSRF pre-session and clears its browser cookie.
 * @param {import('../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {import('../../kixx/http-router/server-response.js').default} response - Response being built.
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

function isSecureRequest(request) {
    return request.url.protocol === 'https:';
}
