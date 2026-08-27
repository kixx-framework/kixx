import process from 'node:process';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
} from 'kixx-assert';
import CookieJar from '../test-helpers/cookie-jar.js';
import {
    createAdminInvite,
    loginRootAdmin,
} from '../test-helpers/authenticate.js';
import {
    assertAdminSessionCookie,
    assertCsrfCookieCleared,
    assertHtmlCsrfToken,
    getBaseUrl,
} from '../test-helpers/lib.js';


let loginCookies;
let loginMissingTokenResponse;
let loginSuccessResponse;
let signupCookies;
let signupMissingTokenResponse;
let signupSuccessResponse;


describe('CSRF authentication boundary', ({ before, it }) => {

    before(async () => {
        const login = await submitLoginBoundaryFlow();
        loginCookies = login.cookieJar;
        loginMissingTokenResponse = login.missingTokenResponse;
        loginSuccessResponse = login.successResponse;

        const signup = await submitSignupBoundaryFlow();
        signupCookies = signup.cookieJar;
        signupMissingTokenResponse = signup.missingTokenResponse;
        signupSuccessResponse = signup.successResponse;
    });

    it('rejects a login without a CSRF token before creating a session', () => {
        assertEqual(403, loginMissingTokenResponse.status);
        assertMatches('Access denied', loginMissingTokenResponse.body);
    });

    it('allows the original valid login submission after rejection', () => {
        assertEqual(303, loginSuccessResponse.status);
        assertEqual('/admin/style-guide', loginSuccessResponse.location);
        assertAuthenticatedJar(loginCookies, loginSuccessResponse.response);
    });

    it('rejects signup without consuming its invite or creating a session', () => {
        assertEqual(403, signupMissingTokenResponse.status);
        assertMatches('Access denied', signupMissingTokenResponse.body);
    });

    it('allows the original valid signup submission after rejection', () => {
        assertEqual(303, signupSuccessResponse.status);
        assertEqual('/admin/style-guide', signupSuccessResponse.location);
        assertAuthenticatedJar(signupCookies, signupSuccessResponse.response);
    });
});

async function submitLoginBoundaryFlow() {
    assertNonEmptyString(process.env.E2E_TESTS_ROOT_USERNAME, 'E2E_TESTS_ROOT_USERNAME');
    assertNonEmptyString(process.env.E2E_TESTS_ROOT_PASSWORD, 'E2E_TESTS_ROOT_PASSWORD');

    const cookieJar = new CookieJar();
    const loginUrl = new URL(`${ getBaseUrl() }/login/admin/new`);
    const formResponse = await fetch(loginUrl, { redirect: 'manual' });
    cookieJar.applyResponse(formResponse);

    const csrfToken = assertHtmlCsrfToken(await formResponse.text());
    const missingTokenResponse = await submitLogin(loginUrl, cookieJar);
    cookieJar.applyResponse(missingTokenResponse.response);
    assert(!cookieJar.get('kixx_admin_session'), 'missing-token login session');

    const successResponse = await submitLogin(loginUrl, cookieJar, csrfToken);
    assertSuccessCookies(successResponse.response);
    cookieJar.applyResponse(successResponse.response);

    return { cookieJar, missingTokenResponse, successResponse };
}

async function submitSignupBoundaryFlow() {
    const rootAdminCookies = await loginRootAdmin();
    const inviteUrl = await createAdminInvite(rootAdminCookies);
    const cookieJar = new CookieJar();
    const signupUrl = new URL(`${ getBaseUrl() }/users/admin/new`);
    const formResponse = await fetch(inviteUrl, { redirect: 'manual' });
    cookieJar.applyResponse(formResponse);

    const formHtml = await formResponse.text();
    const csrfToken = assertHtmlCsrfToken(formHtml);
    const inviteToken = getHtmlFieldValue(formHtml, 'invite_token');
    const credentials = {
        emailAddress: `${ crypto.randomUUID() }@kixx-test.name`,
        password: crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    };

    const missingTokenResponse = await submitSignup(signupUrl, cookieJar, inviteToken, credentials);
    cookieJar.applyResponse(missingTokenResponse.response);
    assert(!cookieJar.get('kixx_admin_session'), 'missing-token signup session');

    const successResponse = await submitSignup(signupUrl, cookieJar, inviteToken, credentials, csrfToken);
    assertSuccessCookies(successResponse.response);
    cookieJar.applyResponse(successResponse.response);

    return { cookieJar, missingTokenResponse, successResponse };
}

async function submitLogin(url, cookieJar, csrfToken = null) {
    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    form.append('email_address', process.env.E2E_TESTS_ROOT_USERNAME);
    form.append('password', process.env.E2E_TESTS_ROOT_PASSWORD);

    const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieJar.cookieHeader() },
        body: form,
    });

    return {
        response,
        status: response.status,
        location: response.headers.get('location'),
        body: await response.text(),
    };
}

async function submitSignup(url, cookieJar, inviteToken, credentials, csrfToken = null) {
    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    form.append('invite_token', inviteToken);
    form.append('email_address', credentials.emailAddress);
    form.append('password', credentials.password);

    const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieJar.cookieHeader() },
        body: form,
    });

    return {
        response,
        status: response.status,
        location: response.headers.get('location'),
        body: await response.text(),
    };
}

function assertSuccessCookies(response) {
    assertCsrfCookieCleared(response);

    const responseCookies = new CookieJar();
    responseCookies.applyResponse(response);
    assertAdminSessionCookie(responseCookies);
}

function assertAuthenticatedJar(cookieJar, response) {
    assertSuccessCookies(response);
    assertAdminSessionCookie(cookieJar);
    assert(!cookieJar.get('kixx_csrf_session'), 'cleared CSRF cookie');
}

function getHtmlFieldValue(html, name) {
    const document = new FastHTMLParser(html);
    const [ field ] = document.getElementsByName(name);
    const value = field?.getAttribute('value');
    assertNonEmptyString(value, `${ name } form field`);

    return value;
}
