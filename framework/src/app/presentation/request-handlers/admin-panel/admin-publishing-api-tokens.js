import PublishingApiTokenCreateForm, {
    PublishingApiTokenRevokeForm,
} from '../../forms/publishing-api-tokens/publishing-api-token-admin-form.js';
import { createPublishingApiToken } from '../../../transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';
import { listPublishingApiTokens } from '../../../transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js';
import { revokePublishingApiToken } from '../../../transaction-scripts/publishing-api-tokens/revoke-publishing-api-token.js';
import {
    INVALID_CSRF_TOKEN_CODE,
    getCsrfFormContext,
    renderWithFreshCsrf,
    validateCsrfFormData,
} from '../../lib/csrf.js';
import {
    createCursorPaginationLinks,
    getCursorPaginationQueryParams,
    rethrowInvalidCursorAsBadRequest,
} from '../../lib/pagination.js';


// Notice code shown when a submission is rejected because its CSRF token was no
// longer live — a page left open past the pre-session TTL, or a back-button
// resubmit of an already-spent token. Doubles as the `form.errorCode` for the
// inline re-render and as the redirect notice from the revoke route.
const FORM_EXPIRED = 'form_expired';
const ALLOWED_TOKEN_NOTICES = new Set([ FORM_EXPIRED ]);


function getRevokeTokenLink(context) {
    return context.getHttpTarget('admin-panel/publishing-api-tokens-revoke/revoke').compilePathname().pathname;
}

function getTokenListPathname(context) {
    return context.getHttpTarget('admin-panel/publishing-api-tokens/render-token-list').compilePathname().pathname;
}

// Loads the page-one list props shared by every POST outcome. A create request
// carries no cursor, so a successful mint and a rejected submission both re-render
// the first page — which is where the newest-first ordering puts a new token, and
// where a user correcting the form expects to land.
async function getFirstPageListProps(context) {
    const { items, cursor: nextCursor } = await listPublishingApiTokens(context, {});
    const links = {
        revokeToken: getRevokeTokenLink(context),
        ...createCursorPaginationLinks({
            pathname: getTokenListPathname(context),
            nextCursor,
        }),
    };

    return {
        tokens: items,
        showPagination: Boolean(links.nextPage),
        links,
    };
}

// Re-renders the token list with a fresh CSRF token and the expired-form notice.
// The notice code replaces the caught error in the form context, so the template
// shows the recoverable "form expired" message rather than a field error, while
// the response still carries the rejection's status.
async function renderFormExpired(context, request, response, error) {
    return renderWithFreshCsrf(context, request, response, {
        form: new PublishingApiTokenCreateForm(),
        props: await getFirstPageListProps(context),
        error: FORM_EXPIRED,
        status: error.httpStatusCode,
    });
}

/**
 * Renders the paginated publishing API token list with a create form.
 *
 * An unrecognized `notice` query parameter is discarded rather than echoed, so
 * the redirect notice cannot be used to inject arbitrary text into the page.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the list, form, and pagination props.
 * @throws {BadRequestError} When the `cursor` query parameter is not a valid signed cursor.
 */
export async function getPublishingApiTokens(context, request, response) {
    const pagination = getCursorPaginationQueryParams(request.queryParams);

    // Surfaces the post-redirect notice from a revoke rejected for an expired
    // form. Unknown notice codes are silently discarded.
    const rawNotice = request.queryParams.notice;
    const noticeCode = ALLOWED_TOKEN_NOTICES.has(rawNotice) ? rawNotice : null;

    let page;
    try {
        page = await listPublishingApiTokens(context, { cursor: pagination.cursor });
    } catch (cause) {
        // Never returns — it either translates an InvalidCursorError into a 400 or
        // rethrows, so `page` is always assigned by the time it is read below.
        rethrowInvalidCursorAsBadRequest(cause);
    }
    const { items, cursor: nextCursor } = page;
    const form = new PublishingApiTokenCreateForm();
    const links = {
        revokeToken: getRevokeTokenLink(context),
        ...createCursorPaginationLinks({
            pathname: getTokenListPathname(context),
            cursor: pagination.cursor,
            history: pagination.history,
            nextCursor,
        }),
    };

    return response.updateProps({
        tokens: items,
        showPagination: Boolean(links.nextPage || links.previousPage),
        form: await getCsrfFormContext(context, request, response, form, noticeCode),
        links,
    });
}

/**
 * Mints a publishing API token and re-renders the list showing its value.
 *
 * This deliberately renders instead of redirecting: the plaintext token exists
 * only on this response and can never be retrieved again. An expired CSRF token
 * or an invalid field re-renders the page with a fresh token rather than failing
 * the request outright.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the list and the one-time token value.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 */
export async function postCreatePublishingApiToken(context, request, response) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_TOKEN_CODE) {
            throw error;
        }
        // An expired form is a recoverable mistake, not an access-control failure
        // the user can act on, so re-render this page with a fresh token and a
        // notice rather than discarding it for the generic 403 page. The status
        // still reports the rejection honestly.
        return await renderFormExpired(context, request, response, error);
    }

    const form = PublishingApiTokenCreateForm.fromFormData(formData);

    try {
        form.validate();
    } catch (error) {
        if (error.name !== 'ValidationError') {
            throw error;
        }

        return await renderWithFreshCsrf(context, request, response, {
            form,
            props: await getFirstPageListProps(context),
            error,
        });
    }

    const created = await createPublishingApiToken(context, form, context.user.id);

    // Render the list directly instead of redirecting (a deliberate exception to
    // post-redirect-get): the plaintext token exists only on this response, so the
    // freshly minted value must be shown now and can never be retrieved again.
    const props = await getFirstPageListProps(context);
    const freshForm = new PublishingApiTokenCreateForm();

    return response.updateProps(Object.assign(props, {
        newToken: created.token,
        form: await getCsrfFormContext(context, request, response, freshForm),
    }));
}

/**
 * Revokes a publishing API token and redirects back to the list.
 *
 * Always redirects (post-redirect-get), so a refresh cannot repeat the revoke.
 * An expired CSRF token redirects with a notice instead of rendering an error.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so the Hyperview page handler does not render over the redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect to the token list.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 * @throws {ValidationError} When the submitted token id is missing or malformed.
 */
export async function postRevokePublishingApiToken(context, request, response, skip) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_TOKEN_CODE) {
            throw error;
        }
        // This route renders no page of its own; it only ever redirects.
        skip();
        const listPathname = getTokenListPathname(context);
        return response.respondWithRedirect(303, `${ listPathname }?notice=${ FORM_EXPIRED }`);
    }

    const form = PublishingApiTokenRevokeForm.fromFormData(formData);

    form.validate();
    await revokePublishingApiToken(context, form.token_id);

    // Revocation carries no one-time secret, so use post-redirect-get back to the
    // list to avoid a duplicate revoke on refresh.
    skip();
    return response.respondWithRedirect(303, getTokenListPathname(context));
}
