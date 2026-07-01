import PublishingApiTokenCreateForm, {
    PublishingApiTokenRevokeForm,
} from '../forms/publishing-api-tokens/publishing-api-token-admin-form.js';
import { createPublishingApiToken } from '../../transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';
import { listPublishingApiTokens } from '../../transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js';
import { revokePublishingApiToken } from '../../transaction-scripts/publishing-api-tokens/revoke-publishing-api-token.js';
import { getCsrfFormContext, validateCsrfFormData } from '../lib/csrf.js';


function getRevokeTokenLink(context) {
    return context.getHttpTarget('admin-panel/publishing-api-tokens-revoke/revoke').compilePathname().pathname;
}

function getTokenListLink(context, cursor) {
    const pathname = context.getHttpTarget('admin-panel/publishing-api-tokens/render-token-list').compilePathname().pathname;

    if (!cursor) {
        return pathname;
    }

    const url = new URL(pathname, 'http://localhost');
    url.searchParams.set('cursor', cursor);
    return `${ url.pathname }${ url.search }`;
}

export async function getPublishingApiTokens(context, request, response) {
    const { items, cursor } = await listPublishingApiTokens(context, { cursor: request.queryParams.cursor });
    const form = new PublishingApiTokenCreateForm();

    return response.updateProps({
        tokens: items,
        nextCursor: cursor,
        form: await getCsrfFormContext(context, request, response, form),
        links: {
            nextPage: getTokenListLink(context, cursor),
            revokeToken: getRevokeTokenLink(context),
        },
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

        const { items, cursor } = await listPublishingApiTokens(context, {});

        return response.updateProps({
            tokens: items,
            nextCursor: cursor,
            form: await getCsrfFormContext(context, request, response, form, error),
            links: {
                nextPage: getTokenListLink(context, cursor),
                revokeToken: getRevokeTokenLink(context),
            },
        });
    }

    const created = await createPublishingApiToken(context, form, context.user.id);

    // Render the list directly instead of redirecting (a deliberate exception to
    // post-redirect-get): the plaintext token exists only on this response, so the
    // freshly minted value must be shown now and can never be retrieved again.
    const { items, cursor } = await listPublishingApiTokens(context, {});
    const freshForm = new PublishingApiTokenCreateForm();

    return response.updateProps({
        tokens: items,
        nextCursor: cursor,
        newToken: created.token,
        form: await getCsrfFormContext(context, request, response, freshForm),
        links: {
            nextPage: getTokenListLink(context, cursor),
            revokeToken: getRevokeTokenLink(context),
        },
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
    return response.respondWithRedirect(303, getTokenListLink(context));
}
