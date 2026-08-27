import process from 'node:process';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
} from 'kixx-assert';
import CookieJar from '../test-helpers/cookies.js';
import { assertHtmlCsrfToken } from '../test-helpers/html.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import validateHtml from '../test-helpers/validate-html.js';


// The synchronizer CSRF token embedded in the login form is only valid when
// paired with the kixx_csrf_session cookie set on the same GET response. This
// jar carries that cookie from the GET describe block to the POST block so the
// server can match the submitted token to its stored pre-session record.
const adminLoginCookies = new CookieJar();

let adminLoginHtmlCsrfToken;


describe('GET /admin without a cookie', ({ before, it }) => {

    let url;
    let response;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin`);
        response = await fetch(url, { redirect: 'manual' });
    });

    it('redirects to the login page', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual(url.href, response.url);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });
});

describe('GET /login/admin/new', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/login/admin/new`);
        response = await fetch(url, { redirect: 'manual' });
        // Store the kixx_csrf_session cookie so the POST can carry the token
        // extracted below through the normal login workflow.
        adminLoginCookies.applyResponse(response);
        body = await response.text();
        adminLoginHtmlCsrfToken = assertHtmlCsrfToken(body);
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

describe('test environment', ({ it }) => {
    it('has process.env.E2E_TESTS_ROOT_USERNAME', () => {
        assertNonEmptyString(process.env.E2E_TESTS_ROOT_USERNAME, 'E2E_TESTS_ROOT_USERNAME');
    });
    it('has process.env.E2E_TESTS_ROOT_PASSWORD', () => {
        assertNonEmptyString(process.env.E2E_TESTS_ROOT_PASSWORD, 'E2E_TESTS_ROOT_PASSWORD');
    });
});

describe('POST /login/admin/new create user session', ({ before, it }) => {

    let url;
    let form;
    let response;

    before(async () => {
        form = new FormData();
        assertNonEmptyString(adminLoginHtmlCsrfToken);
        form.append('csrf_token', adminLoginHtmlCsrfToken);
        form.append('email_address', process.env.E2E_TESTS_ROOT_USERNAME);
        form.append('password', process.env.E2E_TESTS_ROOT_PASSWORD);

        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/login/admin/new`);

        response = await fetch(url, {
            method: 'POST',
            redirect: 'manual',
            // Send the kixx_csrf_session cookie from the GET response so the
            // submitted CSRF token can be matched to its stored pre-session.
            headers: { cookie: adminLoginCookies.cookieHeader() },
            body: form,
        });
        adminLoginCookies.applyResponse(response);
    });

    it('redirects to the admin panel and sets the session', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual(url.href, response.url);
        assertEqual('/admin/style-guide', response.headers.get('location'));
        // The successful login response sets the kixx_admin_session cookie,
        // captured into the jar above, which authenticates later requests.
        assertNonEmptyString(
            adminLoginCookies.get('kixx_admin_session')?.value,
            'kixx_admin_session cookie',
        );
    });
});
