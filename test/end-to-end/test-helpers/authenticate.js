import process from 'node:process';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertNonEmptyString } from 'kixx-assert';
import { getBaseUrl, assertHtmlCsrfToken } from './lib.js';
import CookieJar from './cookie-jar.js';


// Assign random credentials for creating a fresh super admin account for testing.
export const SUPER_ADMIN_USERNAME = `${ crypto.randomUUID() }@kixx-test.name`;
export const SUPER_ADMIN_PASSWORD = crypto.randomUUID().replaceAll('-', '').slice(0, 16);

// Create a super admin carrying the Developer role.
const USER_ROLE_ID = 'developer';

let cachedRootAdmin = null;
let cachedSuperAdmin = null;
let cachedPublishingApiToken = null;


export async function loginRootAdmin() {
    if (cachedRootAdmin) {
        return cachedRootAdmin;
    }

    assertNonEmptyString(process.env.E2E_TESTS_ROOT_USERNAME, 'E2E_TESTS_ROOT_USERNAME');
    assertNonEmptyString(process.env.E2E_TESTS_ROOT_PASSWORD, 'E2E_TESTS_ROOT_PASSWORD');

    cachedRootAdmin = await performRootAdminLogin({
        username: process.env.E2E_TESTS_ROOT_USERNAME,
        password: process.env.E2E_TESTS_ROOT_PASSWORD,
    });

    return cachedRootAdmin;
}

export async function getSuperAdmin() {
    if (cachedSuperAdmin) {
        return cachedSuperAdmin;
    }

    const rootAdmin = await loginRootAdmin();

    cachedSuperAdmin = await createSuperAdmin(
        rootAdmin,
        SUPER_ADMIN_USERNAME,
        SUPER_ADMIN_PASSWORD,
    );

    return cachedSuperAdmin;
}

/**
 * Creates an admin invite and returns its one-time signup URL.
 *
 * Mutates adminCookies with the CSRF cookie refreshed by the invite form and
 * successful invite response.
 *
 * @param {CookieJar} adminCookies - Authenticated cookie jar for an admin allowed to create invites.
 * @param {string} [roleId='developer'] - Attachable admin role granted by the invite.
 * @returns {Promise<URL>} One-time signup URL containing the plaintext invite token.
 * @throws {Error} When the invite form cannot be loaded, its CSRF token is missing, or invite creation fails.
 */
export async function createAdminInvite(adminCookies, roleId = 'developer') {
    assert(adminCookies instanceof CookieJar, 'createAdminInvite adminCookies must be a CookieJar');
    assert(adminCookies.get('kixx_admin_session'), 'createAdminInvite adminCookies must hold an admin session');
    assertNonEmptyString(roleId, 'createAdminInvite roleId');

    const inviteUrl = new URL(`${ getBaseUrl() }/admin/invites`);
    const inviteFormResponse = await fetch(inviteUrl, {
        redirect: 'manual',
        headers: { cookie: adminCookies.cookieHeader() },
    });
    adminCookies.applyResponse(inviteFormResponse);

    if (inviteFormResponse.status !== 200) {
        throw new Error(
            `createAdminInvite: GET /admin/invites returned ${ inviteFormResponse.status }, expected 200`,
        );
    }

    const inviteFormBody = await inviteFormResponse.text();
    const csrfToken = assertHtmlCsrfToken(inviteFormBody);
    const form = new FormData();
    form.append('csrf_token', csrfToken);
    form.append('role_id', roleId);

    const createInviteResponse = await fetch(inviteUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: adminCookies.cookieHeader() },
        body: form,
    });
    adminCookies.applyResponse(createInviteResponse);

    if (createInviteResponse.status !== 200) {
        throw new Error(
            `createAdminInvite: POST /admin/invites returned ${ createInviteResponse.status }, expected 200`,
        );
    }

    const createInviteBody = await createInviteResponse.text();
    const document = new FastHTMLParser(createInviteBody);
    const inviteUrlField = document.getElementById('new-invite-url');
    const signupUrl = inviteUrlField?.getAttribute('value');
    if (!signupUrl) {
        throw new Error('createAdminInvite: no invite URL found in /admin/invites response');
    }

    return new URL(signupUrl);
}

/**
 * Creates and caches a Publishing API token for end-to-end test requests.
 * @returns {Promise<string>} Publishing API bearer token.
 * @throws {Error} When the token form cannot be loaded, a required token is missing, or token creation fails.
 */
export async function getPublishingApiToken() {
    if (cachedPublishingApiToken) {
        return cachedPublishingApiToken;
    }

    const userCookies = await getSuperAdmin();
    const url = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);

    const formResponse = await fetch(url, {
        redirect: 'manual',
        headers: { cookie: userCookies.cookieHeader() },
    });
    userCookies.applyResponse(formResponse);

    if (formResponse.status !== 200) {
        throw new Error(
            `getPublishingApiToken: GET /admin/publishing-api-tokens returned ${ formResponse.status }, expected 200`,
        );
    }

    const formBody = await formResponse.text();
    const csrfToken = assertHtmlCsrfToken(formBody);
    const form = new FormData();
    form.append('csrf_token', csrfToken);
    form.append('description', 'test token');
    form.append('time_to_live_seconds', '2592000');

    const createTokenResponse = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: userCookies.cookieHeader() },
        body: form,
    });
    userCookies.applyResponse(createTokenResponse);

    if (createTokenResponse.status !== 200) {
        throw new Error(
            `getPublishingApiToken: POST /admin/publishing-api-tokens returned ${ createTokenResponse.status }, expected 200`,
        );
    }

    const createTokenBody = await createTokenResponse.text();
    const document = new FastHTMLParser(createTokenBody);
    const tokenField = document.getElementById('new-token');
    const token = tokenField?.getAttribute('value');
    assertNonEmptyString(token, 'getPublishingApiToken token');

    cachedPublishingApiToken = token;
    return cachedPublishingApiToken;
}

/**
 * Creates a Super Admin through the Admin User invite workflow.
 *
 * Mutates rootUserCookies with the CSRF session established while creating the
 * invite. Returns a separate jar holding the new Super Admin session.
 *
 * @param {CookieJar} rootUserCookies - Authenticated cookie jar for a Root Admin User.
 * @param {string} username - Email address for the new Super Admin User.
 * @param {string} password - Password for the new Super Admin User.
 * @returns {Promise<CookieJar>} Cookie jar holding the new Super Admin session.
 * @throws {Error} When an invite form or account form cannot be loaded, a required token is missing, or either submission fails.
 */
export async function createSuperAdmin(rootUserCookies, username, password) {
    assert(rootUserCookies instanceof CookieJar, 'createSuperAdmin rootUserCookies must be a CookieJar');
    assert(rootUserCookies.get('kixx_admin_session'), 'createSuperAdmin rootUserCookies must hold an admin session');
    assertNonEmptyString(username, 'createSuperAdmin username');
    assertNonEmptyString(password, 'createSuperAdmin password');

    const signupUrl = await createAdminInvite(rootUserCookies, USER_ROLE_ID);
    const newAdminUserUrl = new URL(`${ getBaseUrl() }/users/admin/new`);
    const superAdminCookies = new CookieJar();
    const signupFormResponse = await fetch(signupUrl, { redirect: 'manual' });
    superAdminCookies.applyResponse(signupFormResponse);

    if (signupFormResponse.status !== 200) {
        throw new Error(
            `createSuperAdmin: GET /users/admin/new returned ${ signupFormResponse.status }, expected 200`,
        );
    }

    const signupFormBody = await signupFormResponse.text();
    const signupCsrfToken = assertHtmlCsrfToken(signupFormBody);

    const signupDocument = new FastHTMLParser(signupFormBody);
    const [ inviteTokenField ] = signupDocument.getElementsByName('invite_token');
    const inviteToken = inviteTokenField?.getAttribute('value');
    if (!inviteToken) {
        throw new Error('createSuperAdmin: no invite_token field found in /users/admin/new');
    }

    const signupForm = new FormData();
    signupForm.append('csrf_token', signupCsrfToken);
    signupForm.append('invite_token', inviteToken);
    signupForm.append('email_address', username);
    signupForm.append('password', password);

    const createSuperAdminResponse = await fetch(newAdminUserUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: superAdminCookies.cookieHeader() },
        body: signupForm,
    });
    superAdminCookies.applyResponse(createSuperAdminResponse);

    if (createSuperAdminResponse.status !== 303) {
        throw new Error(
            `createSuperAdmin: POST /users/admin/new returned ${ createSuperAdminResponse.status }, expected 303`,
        );
    }

    if (!superAdminCookies.get('kixx_admin_session')) {
        throw new Error('createSuperAdmin: signup response did not set the kixx_admin_session cookie');
    }

    return superAdminCookies;
}

/**
 * Logs in as an Admin User over HTTP and returns the authenticated cookie jar.
 *
 * Performs the full two-request CSRF flow: a GET to render the login form (which
 * yields the kixx_csrf_session cookie and the csrf_token field), then a POST of
 * the credentials carrying that cookie. On success the server sets the
 * kixx_admin_session cookie, which the returned jar holds for use as the `cookie`
 * header on subsequent authenticated requests.
 *
 * @param {Object} [options] - Login options.
 * @param {string} [options.username] - Admin email address. Defaults to E2E_TESTS_ROOT_USERNAME.
 * @param {string} [options.password] - Admin password. Defaults to E2E_TESTS_ROOT_PASSWORD.
 * @param {CookieJar} [options.cookieJar] - Existing jar to populate. A fresh jar is created when omitted.
 * @returns {Promise<CookieJar>} Cookie jar holding the authenticated kixx_admin_session cookie.
 * @throws {Error} When the login form cannot be loaded, the CSRF token is missing, or the credentials are rejected.
 */
export async function performRootAdminLogin(options) {
    const {
        username = process.env.E2E_TESTS_ROOT_USERNAME,
        password = process.env.E2E_TESTS_ROOT_PASSWORD,
        cookieJar = new CookieJar(),
    } = options ?? {};

    assertNonEmptyString(username, 'performAdminLogin username');
    assertNonEmptyString(password, 'performAdminLogin password');

    const loginUrl = new URL(`${ getBaseUrl() }/login/admin/new`);

    // 1. GET the login form to obtain the CSRF pre-session cookie and token.
    const formResponse = await fetch(loginUrl, { redirect: 'manual' });
    cookieJar.applyResponse(formResponse);
    const formBody = await formResponse.text();

    if (formResponse.status !== 200) {
        throw new Error(
            `adminLogin: GET /login/admin/new returned ${ formResponse.status }, expected 200`,
        );
    }

    const csrfToken = assertHtmlCsrfToken(formBody);
    if (!csrfToken) {
        throw new Error('adminLogin: no csrf_token field found in GET /login/admin/new');
    }

    // 2. POST the credentials, sending the CSRF cookie back with the token so the
    // server can match the submitted token to its stored pre-session record.
    const form = new FormData();
    form.append('csrf_token', csrfToken);
    form.append('email_address', username);
    form.append('password', password);

    const loginResponse = await fetch(loginUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieJar.cookieHeader() },
        body: form,
    });
    cookieJar.applyResponse(loginResponse);

    // A successful login redirects to the admin panel and sets the session cookie.
    // Any other outcome (a re-rendered 200 form, a 403, etc.) means auth failed.
    if (loginResponse.status !== 303) {
        throw new Error(
            `adminLogin: POST /login/admin/new returned ${ loginResponse.status }, expected 303`,
        );
    }

    if (!cookieJar.get('kixx_admin_session')) {
        throw new Error('adminLogin: login response did not set the kixx_admin_session cookie');
    }

    return cookieJar;
}
