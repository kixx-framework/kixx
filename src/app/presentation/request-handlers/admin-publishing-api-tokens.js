import PublishingApiTokenCreateForm, {
    PublishingApiTokenRevokeForm,
} from '../forms/publishing-api-tokens/publishing-api-token-admin-form.js';
import { createPublishingApiToken } from '../../transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';
import { listPublishingApiTokens } from '../../transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js';
import { revokePublishingApiToken } from '../../transaction-scripts/publishing-api-tokens/revoke-publishing-api-token.js';
import { getCsrfFormContext, validateCsrfFormData } from '../lib/csrf.js';
import {
    createCursorPaginationLinks,
    getCursorPaginationQueryParams,
    rethrowInvalidCursorAsBadRequest,
} from '../lib/pagination.js';


function getRevokeTokenLink(context) {
    return context.getHttpTarget('admin-panel/publishing-api-tokens-revoke/revoke').compilePathname().pathname;
}

function getTokenListPathname(context) {
    return context.getHttpTarget('admin-panel/publishing-api-tokens/render-token-list').compilePathname().pathname;
}

export async function getPublishingApiTokens(context, request, response) {
    const pagination = getCursorPaginationQueryParams(request.queryParams);
    let page;
    try {
        page = await listPublishingApiTokens(context, { cursor: pagination.cursor });
    } catch (cause) {
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
        form: await getCsrfFormContext(context, request, response, form),
        links,
    });
}

export async function postCreatePublishingApiToken(context, request, response) {
    const formData = await validateCsrfFormData(context, request);
    const form = PublishingApiTokenCreateForm.fromFormData(formData);

    try {
        form.validate();
    } catch (error) {
        if (error.name !== 'ValidationError') {
            throw error;
        }

        const { items, cursor: nextCursor } = await listPublishingApiTokens(context, {});
        const links = {
            revokeToken: getRevokeTokenLink(context),
            ...createCursorPaginationLinks({
                pathname: getTokenListPathname(context),
                nextCursor,
            }),
        };

        return response.updateProps({
            tokens: items,
            showPagination: Boolean(links.nextPage),
            form: await getCsrfFormContext(context, request, response, form, error),
            links,
        });
    }

    const created = await createPublishingApiToken(context, form, context.user.id);

    // Render the list directly instead of redirecting (a deliberate exception to
    // post-redirect-get): the plaintext token exists only on this response, so the
    // freshly minted value must be shown now and can never be retrieved again.
    const { items, cursor: nextCursor } = await listPublishingApiTokens(context, {});
    const freshForm = new PublishingApiTokenCreateForm();
    const links = {
        revokeToken: getRevokeTokenLink(context),
        ...createCursorPaginationLinks({
            pathname: getTokenListPathname(context),
            nextCursor,
        }),
    };

    return response.updateProps({
        tokens: items,
        showPagination: Boolean(links.nextPage),
        newToken: created.token,
        form: await getCsrfFormContext(context, request, response, freshForm),
        links,
    });
}

export async function postRevokePublishingApiToken(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = PublishingApiTokenRevokeForm.fromFormData(formData);

    form.validate();
    await revokePublishingApiToken(context, form.token_id);

    // Revocation carries no one-time secret, so use post-redirect-get back to the
    // list to avoid a duplicate revoke on refresh.
    skip();
    return response.respondWithRedirect(303, getTokenListPathname(context));
}
