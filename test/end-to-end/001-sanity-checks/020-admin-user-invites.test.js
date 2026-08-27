import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
} from 'kixx-assert';
import { FastHTMLParser } from 'fast-html-dom-parser';
import CookieJar from '../test-helpers/cookie-jar.js';
import { getBaseUrl, assertHtmlCsrfToken } from '../test-helpers/lib.js';
import { loginRootAdmin } from '../test-helpers/authenticate.js';
import validateHtml from '../test-helpers/validate-html.js';


let rootAdminCookies;
let formCsrfToken;
let inviteLink;
let inviteToken;

const newSuperAdminCookies = new CookieJar();

const SUPER_ADMIN_USERNAME = `${ crypto.randomUUID() }@kixx-test.name`;
const SUPER_ADMIN_PASSWORD = crypto.randomUUID().replaceAll('-', '').slice(0, 16);


describe('GET /admin/invites without a cookie', ({ before, it }) => {

    let url;
    let response;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/invites`);
        response = await fetch(url, { redirect: 'manual' });
    });

    it('redirects to the login page', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual(url.href, response.url);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });
});


describe('GET /admin/invites as root', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/invites`);

        rootAdminCookies = await loginRootAdmin();

        response = await fetch(url, {
            redirect: 'manual',
            headers: { cookie: rootAdminCookies.cookieHeader() },
        });

        rootAdminCookies.applyResponse(response);

        body = await response.text();

        formCsrfToken = assertHtmlCsrfToken(body);
    });

    it('returns a 200 HTML page', () => {
        assert(response);
        assertEqual(200, response.status);
        assertEqual(url.href, response.url);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        // Match a sample of the HTML document, just to be sure there is something there.
        assertMatches('<!doctype html>', body.slice(0, 50));
    });

    it('renders valid HTML', async () => {
        // The response body is a full HTML document, so it can be validated directly.
        await validateHtml(body);
        const document = new FastHTMLParser(body);
        const [ bodyNode ] = document.getElementsByTagName('body');
        assertEqual('BODY', bodyNode.nodeName);
    });

});


describe('POST /admin/invites create developer admin as root', ({ before, it }) => {

    let url;
    let form;
    let response;
    let body;

    before(async () => {
        // Assert dependencies here so the test fails with an informative
        // message about the assumptions we're making.
        assert(rootAdminCookies);
        assertNonEmptyString(formCsrfToken);

        form = new FormData();
        form.append('csrf_token', formCsrfToken);
        form.append('role_id', 'developer');

        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/invites`);

        response = await fetch(url, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie: rootAdminCookies.cookieHeader() },
            body: form,
        });

        rootAdminCookies.applyResponse(response);

        body = await response.text();

        const document = new FastHTMLParser(body);
        const field = document.getElementById('new-invite-url');
        const href = field?.getAttribute('value');
        assertNonEmptyString(href, 'new invite URL');
        inviteLink = new URL(href);
    });

    it('returns a 200 HTML page', () => {
        assert(response);
        assertEqual(200, response.status);
        assertEqual(url.href, response.url);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        // Match a sample of the HTML document, just to be sure there is something there.
        assertMatches('<!doctype html>', body.slice(0, 50));
    });

    it('renders valid HTML', async () => {
        // The response body is a full HTML document, so it can be validated directly.
        await validateHtml(body);
        const document = new FastHTMLParser(body);
        const [ bodyNode ] = document.getElementsByTagName('body');
        assertEqual('BODY', bodyNode.nodeName);
    });

    it('includes the magic invite link', () => {
        assertEqual('/users/admin/new', inviteLink.pathname);
        assertNonEmptyString(inviteLink.searchParams.get('invite'));
    });
});


describe('GET /users/admin/new redeem invite link', ({ before, it }) => {

    let response;
    let body;

    before(async () => {

        response = await fetch(inviteLink, {
            redirect: 'manual',
        });

        newSuperAdminCookies.applyResponse(response);

        body = await response.text();

        const document = new FastHTMLParser(body);
        const [ inviteField ] = document.getElementsByName('invite_token');
        formCsrfToken = assertHtmlCsrfToken(body);
        inviteToken = inviteField?.getAttribute('value');
    });

    it('returns a 200 HTML page', () => {
        assert(response);
        assertEqual(200, response.status);
        assertEqual(inviteLink.href, response.url);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        // Match a sample of the HTML document, just to be sure there is something there.
        assertMatches('<!doctype html>', body.slice(0, 50));
    });

    it('renders valid HTML', async () => {
        // The response body is a full HTML document, so it can be validated directly.
        await validateHtml(body);
        const document = new FastHTMLParser(body);
        const [ bodyNode ] = document.getElementsByTagName('body');
        assertEqual('BODY', bodyNode.nodeName);
    });

    it('includes the invite token', () => {
        assertNonEmptyString(inviteToken, 'form invite_token');
    });
});


describe('POST /users/admin/new redeem invite', ({ before, it }) => {

    let url;
    let form;
    let response;

    before(async () => {
        // Assert dependencies here so the test fails with an informative
        // message about the assumptions we're making.
        assertNonEmptyString(formCsrfToken);
        assertNonEmptyString(inviteToken);

        form = new FormData();
        form.append('csrf_token', formCsrfToken);
        form.append('invite_token', inviteToken);
        form.append('email_address', SUPER_ADMIN_USERNAME);
        form.append('password', SUPER_ADMIN_PASSWORD);

        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/users/admin/new`);

        response = await fetch(url, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie: newSuperAdminCookies.cookieHeader() },
            body: form,
        });

        newSuperAdminCookies.applyResponse(response);
    });

    it('redirects to the admin page', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual('/admin/style-guide', response.headers.get('location'));
        assertNonEmptyString(
            newSuperAdminCookies.get('kixx_admin_session')?.value,
            'kixx_admin_session cookie',
        );
    });
});
