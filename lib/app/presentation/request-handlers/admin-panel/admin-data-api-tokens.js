import AdminDataApiTokenCreateForm, {
    AdminDataApiTokenRevokeForm,
} from '../../forms/admin-data-api-tokens/admin-data-api-token-admin-form.js';
import { createAdminDataApiToken } from '../../../transaction-scripts/admin-data-api-tokens/create-admin-data-api-token.js';
import { listAdminDataApiTokens } from '../../../transaction-scripts/admin-data-api-tokens/list-admin-data-api-tokens.js';
import { revokeAdminDataApiToken } from '../../../transaction-scripts/admin-data-api-tokens/revoke-admin-data-api-token.js';
import { adminDataResources } from '../../../admin-data-api/mod.js';
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


// Shared notice code for a submission whose CSRF token was no longer live: the
// create form's inline errorCode and the revoke route's redirect notice.
const FORM_EXPIRED = 'form_expired';
const ALLOWED_TOKEN_NOTICES = new Set([ FORM_EXPIRED ]);


function getRevokeTokenLink(context) {
    return context.getHttpTarget('admin-panel/admin-data-api-tokens-revoke/revoke').compilePathname().pathname;
}

function getTokenListPathname(context) {
    return context.getHttpTarget('admin-panel/admin-data-api-tokens/render-token-list').compilePathname().pathname;
}

// Grants are stored by Collection; show each with its public resource type so
// operators see the name API clients use. A grant whose Collection is no
// longer registered still renders, flagged, because it confers nothing now.
function presentToken(token) {
    return Object.assign({}, token, {
        grants: token.grants.map((grant) => {
            const resource = adminDataResources.getResourceByCollection(grant.collection);
            return {
                collection: grant.collection,
                type: resource ? resource.type : null,
                isRetired: !resource,
                actions: grant.actions.join(', '),
            };
        }),
    });
}

// Page-one list props shared by every POST outcome. A create request carries
// no cursor, and newest-first ordering puts a new token on page one.
async function getFirstPageListProps(context) {
    const { items, cursor: nextCursor } = await listAdminDataApiTokens(context, {});
    const links = {
        revokeToken: getRevokeTokenLink(context),
        ...createCursorPaginationLinks({
            pathname: getTokenListPathname(context),
            nextCursor,
        }),
    };

    return {
        tokens: items.map(presentToken),
        showPagination: Boolean(links.nextPage),
        links,
    };
}

/**
 * Renders the paginated Administrative Data API token list with a create form.
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
export async function getAdminDataApiTokens(context, request, response) {
    const pagination = getCursorPaginationQueryParams(request.queryParams);

    const rawNotice = request.queryParams.notice;
    const noticeCode = ALLOWED_TOKEN_NOTICES.has(rawNotice) ? rawNotice : null;

    let page;
    try {
        page = await listAdminDataApiTokens(context, { cursor: pagination.cursor });
    } catch (cause) {
        // Never returns: translates InvalidCursorError to a 400 or rethrows.
        rethrowInvalidCursorAsBadRequest(cause);
    }

    const { items, cursor: nextCursor } = page;
    const form = new AdminDataApiTokenCreateForm();
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
        tokens: items.map(presentToken),
        showPagination: Boolean(links.nextPage || links.previousPage),
        form: await getCsrfFormContext(context, request, response, form, noticeCode),
        links,
    });
}

/**
 * Mints an Administrative Data API token and re-renders the list showing its secret once.
 *
 * This deliberately renders instead of redirecting: the plaintext token exists
 * only on this response, so it must never travel through a redirect URL, a
 * session, or a later GET. An expired CSRF token or an invalid field
 * re-renders the page with a fresh token and the submitted safe fields.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the list and the one-time token value.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 */
export async function postCreateAdminDataApiToken(context, request, response) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_TOKEN_CODE) {
            throw error;
        }
        // An expired form is recoverable: re-render with a fresh token and a
        // notice while the status still reports the rejection.
        return await renderWithFreshCsrf(context, request, response, {
            form: new AdminDataApiTokenCreateForm(),
            props: await getFirstPageListProps(context),
            error: FORM_EXPIRED,
            status: error.httpStatusCode,
        });
    }

    const form = AdminDataApiTokenCreateForm.fromFormData(formData);

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

    const created = await createAdminDataApiToken(context, form, context.user.id);

    const props = await getFirstPageListProps(context);
    const freshForm = new AdminDataApiTokenCreateForm();

    return response.updateProps(Object.assign(props, {
        newToken: created.token,
        form: await getCsrfFormContext(context, request, response, freshForm),
    }));
}

/**
 * Revokes an Administrative Data API token and redirects back to the list.
 *
 * Always redirects (post-redirect-get), so a refresh cannot repeat the revoke.
 * An expired CSRF token redirects with a notice instead of rendering an error.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so no page handler renders over the redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect to the token list.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 * @throws {ValidationError} When the submitted token id is missing.
 * @throws {NotFoundError} When the token does not exist.
 * @throws {ConflictError} When the token is not revocable or was modified concurrently.
 */
export async function postRevokeAdminDataApiToken(context, request, response, skip) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_TOKEN_CODE) {
            throw error;
        }
        skip();
        return response.respondWithRedirect(303, `${ getTokenListPathname(context) }?notice=${ FORM_EXPIRED }`);
    }

    const form = AdminDataApiTokenRevokeForm.fromFormData(formData);

    form.validate();
    await revokeAdminDataApiToken(context, form.token_id);

    skip();
    return response.respondWithRedirect(303, getTokenListPathname(context));
}
