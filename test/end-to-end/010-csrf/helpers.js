import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertEqual, assertNonEmptyString } from 'kixx-assert';
import {
    CSRF_COOKIE_NAME,
    CSRF_TOKEN_TTL_SECONDS,
} from '../../../src/app/presentation/lib/csrf.js';
import { ADMIN_SESSION_COOKIE_NAME } from '../../../src/app/presentation/lib/admin-session-cookie.js';
import { ADMIN_SESSION_TTL_SECONDS } from '../../../src/app/lib/admin-session.js';
import { getSetCookies } from '../test-helpers/cookies.js';
import { getBaseUrl } from '../test-helpers/target-url.js';


/**
 * Asserts the public policy of the live CSRF session cookie.
 * @param {import('../test-helpers/cookies.js').default} cookieJar - Jar holding the response cookies.
 * @returns {string} Non-empty CSRF session identifier.
 */
export function assertCsrfCookie(cookieJar) {
    const cookie = cookieJar.get(CSRF_COOKIE_NAME);
    assert(cookie, `${ CSRF_COOKIE_NAME } cookie`);

    assertEqual('/', cookie.path);
    assertEqual(CSRF_TOKEN_TTL_SECONDS, cookie.maxAge);
    assertEqual(true, cookie.httpOnly);
    assertEqual('lax', cookie.sameSite.toLowerCase());
    assertEqual(null, cookie.domain);
    assertEqual(isSecureBaseUrl(), cookie.secure);
    assertNonEmptyString(cookie.value);

    return cookie.value;
}

/**
 * Asserts the public policy of a live admin authentication session cookie.
 * @param {import('../test-helpers/cookies.js').default} cookieJar - Jar holding the response cookies.
 * @returns {string} Non-empty admin session identifier.
 */
export function assertAdminSessionCookie(cookieJar) {
    const cookie = cookieJar.get(ADMIN_SESSION_COOKIE_NAME);
    assert(cookie, `${ ADMIN_SESSION_COOKIE_NAME } cookie`);

    assertEqual('/', cookie.path);
    assertEqual(ADMIN_SESSION_TTL_SECONDS, cookie.maxAge);
    assertEqual(true, cookie.httpOnly);
    assertEqual('lax', cookie.sameSite.toLowerCase());
    assertEqual(null, cookie.domain);
    assertEqual(isSecureBaseUrl(), cookie.secure);
    assertNonEmptyString(cookie.value);

    return cookie.value;
}

/**
 * Asserts that a response clears the CSRF cookie before a CookieJar applies it.
 * @param {Response} response - Authentication response containing Set-Cookie headers.
 * @returns {void}
 */
export function assertCsrfCookieCleared(response) {
    const cookie = getSetCookies(response).find(({ name }) => name === CSRF_COOKIE_NAME);
    assert(cookie, `${ CSRF_COOKIE_NAME } clearing cookie`);

    assertEqual('', cookie.value);
    assertEqual(0, cookie.maxAge);
    assertEqual('/', cookie.path);
    assertEqual(true, cookie.httpOnly);
    assertEqual('lax', cookie.sameSite.toLowerCase());
    assertEqual(null, cookie.domain);
    assertEqual(isSecureBaseUrl(), cookie.secure);
}

/**
 * Decodes and validates the public payload envelope of a rendered CSRF token.
 * @param {string} token - CSRF token extracted from a rendered form.
 * @returns {{sid: string, exp: number}} Parsed token payload without verifying its signature.
 */
export function decodeCsrfToken(token) {
    assertNonEmptyString(token, 'CSRF token');

    const segments = token.split('.');
    assertEqual(2, segments.length, 'CSRF token segments');

    const [ payloadSegment, signatureSegment ] = segments;
    assertBase64urlSegment(payloadSegment, 'CSRF token payload');
    assertBase64urlSegment(signatureSegment, 'CSRF token signature');

    const payload = parseJson(decodeBase64url(payloadSegment));
    assert(isPlainObject(payload), 'CSRF token payload');
    assertNonEmptyString(payload.sid, 'CSRF token payload sid');
    assert(Number.isInteger(payload.exp), 'CSRF token payload exp');

    return payload;
}

/**
 * Returns record identifiers carried by rendered mutation forms.
 * @param {string} html - Rendered HTML containing hidden record-id fields.
 * @param {string} fieldName - Hidden field name that carries the record id.
 * @returns {string[]} Record ids in document order.
 */
export function getRenderedRecordIds(html, fieldName) {
    const document = new FastHTMLParser(html);
    const fields = document.getElementsByName(fieldName);
    const recordIds = [];

    for (const field of fields) {
        const recordId = field.getAttribute('value');
        assertNonEmptyString(recordId, `${ fieldName } record id`);
        recordIds.push(recordId);
    }

    return recordIds;
}

function isSecureBaseUrl() {
    return new URL(getBaseUrl()).protocol === 'https:';
}

function assertBase64urlSegment(segment, name) {
    assertNonEmptyString(segment, name);
    assert(/^[A-Za-z0-9_-]+$/.test(segment), `${ name } base64url encoding`);
}

function decodeBase64url(segment) {
    const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(`${ base64 }${ padding }`);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        assert(false, 'CSRF token payload JSON');
        return null;
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
