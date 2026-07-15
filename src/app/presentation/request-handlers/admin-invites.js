import AdminInviteCreateForm, { AdminInviteRevokeForm } from '../forms/admin-invites/admin-invite-form.js';
import { createAdminInvite } from '../../transaction-scripts/admin-invites/create-admin-invite.js';
import { listAdminInvites } from '../../transaction-scripts/admin-invites/list-admin-invites.js';
import { revokeAdminInvite } from '../../transaction-scripts/admin-invites/revoke-admin-invite.js';
import { getCsrfFormContext, validateCsrfFormData } from '../lib/csrf.js';
import {
    getCursorQueryParam,
    getInviteListHistoryQueryParam,
    rethrowInvalidCursorAsBadRequest,
} from '../lib/pagination.js';


function getRevokeInviteLink(context) {
    return context.getHttpTarget('admin-panel/invites-revoke/revoke').compilePathname().pathname;
}

function getInviteListLink(context, cursor, history) {
    const pathname = context.getHttpTarget('admin-panel/invites/render-invite-list').compilePathname().pathname;
    const url = new URL(pathname, 'http://localhost');

    if (cursor) {
        url.searchParams.set('cursor', cursor);
    }

    for (const ancestorCursor of history ?? []) {
        url.searchParams.append('history', ancestorCursor);
    }

    return `${ url.pathname }${ url.search }`;
}

// Builds the absolute signup link an invitee follows. The raw token is only
// available right after minting, so this URL is shown once and cannot be rebuilt
// later from stored data.
function buildSignupInviteUrl(context, request, token) {
    const signupPath = context.getHttpTarget('new-admin-user-form/render-form').compilePathname().pathname;
    return `${ request.url.origin }${ signupPath }?invite=${ encodeURIComponent(token) }`;
}

export async function getAdminInvites(context, request, response) {
    const requestCursor = getCursorQueryParam(request.queryParams);
    const history = getInviteListHistoryQueryParam(request.queryParams);

    let page;
    try {
        page = await listAdminInvites(context, { cursor: requestCursor });
    } catch (cause) {
        rethrowInvalidCursorAsBadRequest(cause);
    }
    const { items, cursor: nextCursor } = page;
    const form = new AdminInviteCreateForm();

    const links = {
        revokeInvite: getRevokeInviteLink(context),
    };

    if (nextCursor) {
        // The current page's own cursor (possibly empty, for page one) becomes the
        // newest entry in the next page's ancestor history.
        links.nextPage = getInviteListLink(context, nextCursor, [ ...history, requestCursor ?? '' ]);
    }

    if (history.length) {
        const previousCursor = history[history.length - 1];
        const previousHistory = history.slice(0, -1);
        links.previousPage = getInviteListLink(context, previousCursor || undefined, previousHistory);
    }

    return response.updateProps({
        invites: items,
        showPagination: Boolean(links.nextPage || links.previousPage),
        form: await getCsrfFormContext(context, request, response, form),
        links,
    });
}

export async function postCreateAdminInvite(context, request, response) {
    // CSRF is validated before any mutation; the create form carries no other fields.
    await validateCsrfFormData(context, request);

    const created = await createAdminInvite(context, { createdBy: context.user.id });
    const inviteUrl = buildSignupInviteUrl(context, request, created.token);

    // Render the list directly instead of redirecting (a deliberate exception to
    // post-redirect-get): the plaintext token exists only on this response, so the
    // freshly minted link must be shown now and can never be retrieved again.
    const { items, cursor: nextCursor } = await listAdminInvites(context, {});
    const form = new AdminInviteCreateForm();

    const links = {
        revokeInvite: getRevokeInviteLink(context),
    };

    // Freshly created invites are always shown starting from page one, so there is
    // no ancestor history yet and no previous-page link to offer.
    if (nextCursor) {
        links.nextPage = getInviteListLink(context, nextCursor, [ '' ]);
    }

    return response.updateProps({
        invites: items,
        newInviteUrl: inviteUrl,
        showPagination: Boolean(links.nextPage),
        form: await getCsrfFormContext(context, request, response, form),
        links,
    });
}

export async function postRevokeAdminInvite(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = AdminInviteRevokeForm.fromFormData(formData);

    form.validate();
    await revokeAdminInvite(context, form.invite_id);

    // Revocation carries no one-time secret, so use post-redirect-get back to the
    // list to avoid a duplicate revoke on refresh.
    skip();
    return response.respondWithRedirect(303, getInviteListLink(context));
}
