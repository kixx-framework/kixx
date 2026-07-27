import process from 'node:process';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertEqual, assertNonEmptyString } from 'kixx-assert';


export function getBaseUrl() {
    assertNonEmptyString(process.env.E2E_TESTS_BASE_URL, 'E2E_TESTS_BASE_URL');
    // Make sure the URL string is good enough for the URL parser.
    const _url = new URL(process.env.E2E_TESTS_BASE_URL);
    return process.env.E2E_TESTS_BASE_URL.replace(/\/$/, '');
}

export function assertCsrfCookie(cookieJar) {
    const cookie = cookieJar.get('kixx_csrf_session');
    assertEqual('/', cookie.path);
    assertEqual(1800, cookie.maxAge);
    assertEqual(true, cookie.httpOnly);
    assertEqual('lax', cookie.sameSite.toLowerCase());
    assertNonEmptyString(cookie.value);
    return cookie.value;
}

export function assertHtmlCsrfToken(html) {
    const document = new FastHTMLParser(html);
    const [ field ] = document.getElementsByName('csrf_token');
    assert(field);
    const token = field.getAttribute('value');
    assertNonEmptyString(token);
    return token;
}
