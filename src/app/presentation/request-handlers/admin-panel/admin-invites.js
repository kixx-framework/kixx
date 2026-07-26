import AdminInviteCreateForm, { AdminInviteRevokeForm } from '../../forms/admin-invites/admin-invite-form.js';
import { createAdminInvite } from '../../../transaction-scripts/admin-invites/create-admin-invite.js';
import { listAdminInvites } from '../../../transaction-scripts/admin-invites/list-admin-invites.js';
import { revokeAdminInvite } from '../../../transaction-scripts/admin-invites/revoke-admin-invite.js';
import { getCsrfFormContext, validateCsrfFormData } from '../../lib/csrf.js';
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
const ALLOWED_INVITE_NOTICES = new Set([ FORM_EXPIRED ]);

// The CSRF helper reports an expired or mismatched token with this code on a
// ForbiddenError. Left uncaught it reaches adminErrorHandler, which replaces the
// whole invite list with a generic 403 "Access denied" page.
const INVALID_CSRF_CODE = 'InvalidCsrfTokenError';


function getRevokeInviteLink(context) {
    return context.getHttpTarget('admin-panel/invites-revoke/revoke').compilePathname().pathname;
}

function getInviteListPathname(context) {
    return context.getHttpTarget('admin-panel/invites/render-invite-list').compilePathname().pathname;
}

// Builds the absolute signup link an invitee follows. The raw token is only
// available right after minting, so this URL is shown once and cannot be rebuilt
// later from stored data.
function buildSignupInviteUrl(context, request, token) {
    const signupPath = context.getHttpTarget('new-admin-user-form/render-form').compilePathname().pathname;
    return `${ request.url.origin }${ signupPath }?invite=${ encodeURIComponent(token) }`;
}

// Loads the page-one list props shared by both POST outcomes. A create request
// carries no cursor, so a successful mint and a rejected submission both re-render
// the first page — which is where the newest-first ordering puts a new invite, and
// where a user correcting the form expects to land.
async function getFirstPageListProps(context) {
    const { items, cursor: nextCursor } = await listAdminInvites(context, {});
    const links = {
        revokeInvite: getRevokeInviteLink(context),
        ...createCursorPaginationLinks({
            pathname: getInviteListPathname(context),
            nextCursor,
        }),
    };

    return {
        invites: items,
        showPagination: Boolean(links.nextPage),
        links,
    };
}

export async function getAdminInvites(context, request, response) {
    const pagination = getCursorPaginationQueryParams(request.queryParams);

    // Surfaces the post-redirect notice from a revoke rejected for an expired
    // form. Unknown notice codes are silently discarded.
    const rawNotice = request.queryParams.notice;
    const noticeCode = ALLOWED_INVITE_NOTICES.has(rawNotice) ? rawNotice : null;

    let page;
    try {
        page = await listAdminInvites(context, { cursor: pagination.cursor });
    } catch (cause) {
        rethrowInvalidCursorAsBadRequest(cause);
    }
    const { items, cursor: nextCursor } = page;
    const form = new AdminInviteCreateForm();
    const links = {
        revokeInvite: getRevokeInviteLink(context),
        ...createCursorPaginationLinks({
            pathname: getInviteListPathname(context),
            cursor: pagination.cursor,
            history: pagination.history,
            nextCursor,
        }),
    };

    return response.updateProps({
        invites: items,
        showPagination: Boolean(links.nextPage || links.previousPage),
        form: await getCsrfFormContext(context, request, response, form, noticeCode),
        links,
    });
}

export async function postCreateAdminInvite(context, request, response) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_CODE) {
            throw error;
        }
        // An expired form is a recoverable mistake, not an access-control failure
        // the user can act on, so re-render this page with a fresh token and a
        // notice rather than discarding it for the generic 403 page. The status
        // still reports the rejection honestly.
        return await renderFormExpired(context, request, response, error);
    }

    const form = AdminInviteCreateForm.fromFormData(formData);

    // An unselected role preset is a correctable field error, so re-render this
    // page inline
    try {
        form.validate();
    } catch (error) {
        if (error.name !== 'ValidationError') {
            throw error;
        }

        const props = await getFirstPageListProps(context);

        response.status = error.httpStatusCode || 500;
        return response.updateProps(Object.assign(props, {
            // Passing the caught error back through the form context is what
            // populates fields.role_preset.error for the template.
            form: await getCsrfFormContext(context, request, response, form, error),
        }));
    }

    const created = await createAdminInvite(context, {
        createdBy: context.user.id,
        rolePreset: form.role_preset,
    });
    const inviteUrl = buildSignupInviteUrl(context, request, created.token);

    // Render the list directly instead of redirecting: the plaintext token
    // exists only on this response, so the freshly minted link must
    // be shown now and can never be retrieved again.
    const props = await getFirstPageListProps(context);
    const renderForm = new AdminInviteCreateForm();

    return response.updateProps(Object.assign(props, {
        newInviteUrl: inviteUrl,
        form: await getCsrfFormContext(context, request, response, renderForm),
    }));
}

// Re-renders the invite list with a fresh CSRF token and the expired-form notice.
async function renderFormExpired(context, request, response, error) {
    const props = await getFirstPageListProps(context);
    const form = new AdminInviteCreateForm();

    response.status = error.httpStatusCode || 500;
    return response.updateProps(Object.assign(props, {
        form: await getCsrfFormContext(context, request, response, form, FORM_EXPIRED),
    }));
}

export async function postRevokeAdminInvite(context, request, response, skip) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_CODE) {
            throw error;
        }
        // This route renders no page of its own; it only ever redirects.
        skip();
        const listPathname = getInviteListPathname(context);
        return response.respondWithRedirect(303, `${ listPathname }?notice=${ FORM_EXPIRED }`);
    }

    const form = AdminInviteRevokeForm.fromFormData(formData);

    form.validate();
    await revokeAdminInvite(context, form.invite_id);

    // Revocation carries no one-time secret, so use post-redirect-get back to the
    // list to avoid a duplicate revoke on refresh.
    skip();
    return response.respondWithRedirect(303, getInviteListPathname(context));
}
