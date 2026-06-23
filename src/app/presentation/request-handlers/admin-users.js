import NewAdminUserForm from '../forms/admin-users/new-admin-user-form.js';
import AdminUserLoginForm from '../forms/admin-users/admin-user-login-form.js';


const ALLOWED_LOGIN_NOTICES = new Set([ 'session_create_failed' ]);


export function getNewAdminUserForm(context, _request, response) {
    const form = new NewAdminUserForm();
    const loginTarget = context.getHttpTarget('admin-login-form/render-form');
    const links = { loginForm: loginTarget.compilePathname().pathname };
    return response.updateProps({ form: form.getFormContext(context), links });
}

export function getAdminUserLoginForm(context, request, response) {
    const form = new AdminUserLoginForm();
    const newUserTarget = context.getHttpTarget('new-admin-user-form/render-form');
    const links = { newUserForm: newUserTarget.compilePathname().pathname };

    // Reads an optional `notice` query parameter to surface post-redirect notices
    // (e.g. when signup completed but auto-login failed). Unknown notice codes are
    // silently discarded.
    const raw = request.queryParams.notice;
    const noticeCode = ALLOWED_LOGIN_NOTICES.has(raw) ? raw : null;

    return response.updateProps({ form: form.getFormContext(context, noticeCode), links });
}
