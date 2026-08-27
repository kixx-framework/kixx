import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
} from 'kixx-assert';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { getBaseUrl, assertHtmlCsrfToken } from '../test-helpers/lib.js';
import { getSuperAdmin } from '../test-helpers/authenticate.js';
import validateHtml from '../test-helpers/validate-html.js';


let formCsrfToken;
let userCookies;


describe('GET /admin/publishing-api-tokens', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);

        userCookies = await getSuperAdmin();

        response = await fetch(url, {
            redirect: 'manual',
            headers: { cookie: userCookies.cookieHeader() },
        });

        userCookies.applyResponse(response);

        body = await response.text();
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

    it('prepares the token form submission', () => {
        formCsrfToken = assertHtmlCsrfToken(body);
    });
});

describe('POST /admin/publishing-api-tokens', ({ before, it }) => {

    let url;
    let form;
    let response;
    let body;

    before(async () => {
        // Assert dependencies here so the test fails with an informative
        // message about the assumptions we're making.
        assert(userCookies);
        assertNonEmptyString(formCsrfToken);

        form = new FormData();
        form.append('csrf_token', formCsrfToken);
        form.append('description', 'test token');
        form.append('time_to_live_seconds', '2592000');

        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);

        response = await fetch(url, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie: userCookies.cookieHeader() },
            body: form,
        });

        userCookies.applyResponse(response);

        body = await response.text();
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

    it('includes the new token', () => {
        const document = new FastHTMLParser(body);
        const field = document.getElementById('new-token');
        const href = field.getAttribute('value');
        assertNonEmptyString(href);
    });
});

describe('GET /admin/publishing-api-tokens without a cookie', ({ before, it }) => {

    let url;
    let response;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);
        response = await fetch(url, { redirect: 'manual' });
    });

    it('redirects to the login page', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual(url.href, response.url);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });
});

describe('POST /admin/publishing-api-tokens without a cookie', ({ before, it }) => {

    let url;
    let form;
    let response;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);

        form = new FormData();
        // Invalid payload, but we expect authn to fail first.
        form.append('csrf_token', 'foo');

        response = await fetch(url, {
            method: 'POST',
            redirect: 'manual',
            body: form,
        });
    });

    it('rejects', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual(url.href, response.url);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });
});
