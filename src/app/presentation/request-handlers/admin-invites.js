import AdminInviteCreateForm, { AdminInviteRevokeForm } from '../forms/admin-invites/admin-invite-form.js';
import { createAdminInvite } from '../../transaction-scripts/admin-invites/create-admin-invite.js';
import { listAdminInvites } from '../../transaction-scripts/admin-invites/list-admin-invites.js';
import { revokeAdminInvite } from '../../transaction-scripts/admin-invites/revoke-admin-invite.js';
import { getCsrfFormContext, validateCsrfFormData } from '../lib/csrf.js';


function getRevokeInviteLink(context) {
    return context.getHttpTarget('admin-panel/invites-revoke/revoke').compilePathname().pathname;
}

function getInviteListLink(context, cursor) {
    const pathname = context.getHttpTarget('admin-panel/invites/render-invite-list').compilePathname().pathname;

    if (!cursor) {
        return pathname;
    }

    const url = new URL(pathname, 'http://localhost');
    url.searchParams.set('cursor', cursor);
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
    const { items, cursor } = await listAdminInvites(context, { cursor: request.queryParams.cursor });
    const form = new AdminInviteCreateForm();

    return response.updateProps({
        invites: items,
        nextCursor: cursor,
        form: await getCsrfFormContext(context, request, response, form),
        links: {
            nextPage: getInviteListLink(context, cursor),
            revokeInvite: getRevokeInviteLink(context),
        },
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
    const { items, cursor } = await listAdminInvites(context, {});
    const form = new AdminInviteCreateForm();

    return response.updateProps({
        invites: items,
        nextCursor: cursor,
        newInviteUrl: inviteUrl,
        form: await getCsrfFormContext(context, request, response, form),
        links: {
            nextPage: getInviteListLink(context, cursor),
            revokeInvite: getRevokeInviteLink(context),
        },
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
