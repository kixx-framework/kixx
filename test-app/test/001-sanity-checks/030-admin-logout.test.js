import { parseHTML } from 'parse-html-dom';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertMatches,
} from 'kixx-assert';
import {
    createInvitedAdmin,
    loginRootAdmin,
} from '../test-helpers/admin-workflows.js';
import { assertHtmlCsrfToken } from '../test-helpers/html.js';
import { getBaseUrl } from '../test-helpers/target-url.js';


// Logs out a freshly invited admin, never the cached root admin session that
// other tests share.
const emailAddress = `${ crypto.randomUUID() }@kixx-test.name`;

let adminCookies;
let sessionCookieHeader;


describe('GET /login/admin/new with a valid admin session', ({ before, it }) => {

    let response;
    let body;
    let document;

    before(async () => {
        const rootAdminCookies = await loginRootAdmin();
        adminCookies = await createInvitedAdmin(rootAdminCookies, { username: emailAddress });
        sessionCookieHeader = adminCookies.cookieHeader([ 'kixx_admin_session' ]);

        response = await fetch(new URL(`${ getBaseUrl() }/login/admin/new`), {
            redirect: 'manual',
            headers: { cookie: adminCookies.cookieHeader() },
        });
        adminCookies.applyResponse(response);
        body = await response.text();
        document = parseHTML(body);
    });

    it('renders the already-logged-in prompt instead of redirecting', () => {
        assertEqual(200, response.status);
        assert(body.includes(emailAddress), 'names the logged-in account');
        assertEqual(0, document.querySelectorAll('[name="password"]').length);
    });

    it('links to the admin panel and offers a logout form', () => {
        assertMatches(/href="\/admin\/?"/, body);
        assertMatches('action="/logout/admin"', body);
    });
});

describe('Admin panel header with a valid admin session', ({ before, it }) => {

    let body;

    before(async () => {
        const response = await fetch(new URL(`${ getBaseUrl() }/admin`), {
            redirect: 'manual',
            headers: { cookie: adminCookies.cookieHeader() },
        });
        adminCookies.applyResponse(response);
        body = await response.text();
    });

    it('names the account and offers a logout form', () => {
        assert(body.includes(emailAddress), 'names the logged-in account');
        assertMatches('action="/logout/admin"', body);
        assertHtmlCsrfToken(body);
    });
});

describe('GET /users/admin/new with a valid admin session', ({ before, it }) => {

    let response;
    let body;

    before(async () => {
        response = await fetch(new URL(`${ getBaseUrl() }/users/admin/new?invite=some-invite`), {
            redirect: 'manual',
            headers: { cookie: adminCookies.cookieHeader() },
        });
        adminCookies.applyResponse(response);
        body = await response.text();
    });

    it('offers a logout that returns to the invite link', () => {
        assertEqual(200, response.status);
        assert(body.includes(emailAddress), 'names the logged-in account');
        assertMatches('action="/logout/admin"', body);
        assertMatches(/name="return_to" value="\/users\/admin\/new\?invite=some-invite"/, body);
    });
});

describe('POST /logout/admin', ({ before, it }) => {

    let loginPage;
    let response;
    let staleSessionResponse;

    before(async () => {
        loginPage = await fetch(new URL(`${ getBaseUrl() }/login/admin/new`), {
            redirect: 'manual',
            headers: { cookie: adminCookies.cookieHeader() },
        });
        adminCookies.applyResponse(loginPage);

        const form = new FormData();
        form.append('csrf_token', assertHtmlCsrfToken(await loginPage.text()));

        response = await fetch(new URL(`${ getBaseUrl() }/logout/admin`), {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie: adminCookies.cookieHeader() },
            body: form,
        });
        adminCookies.applyResponse(response);

        // Replay the pre-logout session cookie to prove the stored session is gone.
        staleSessionResponse = await fetch(new URL(`${ getBaseUrl() }/admin`), {
            redirect: 'manual',
            headers: { cookie: sessionCookieHeader },
        });
    });

    it('redirects to the login form', () => {
        assertEqual(303, response.status);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });

    it('clears the admin session cookie', () => {
        assertFalsy(adminCookies.get('kixx_admin_session'));
    });

    it('deletes the stored session', () => {
        assertEqual(303, staleSessionResponse.status);
        assertEqual('/login/admin/new', staleSessionResponse.headers.get('location'));
    });
});
