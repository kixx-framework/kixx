import { describe } from 'kixx-test';
import { assertEqual, assertFalsy } from 'kixx-assert';

import {
    ADMIN_SESSION_COOKIE_NAME,
    clearAdminSessionCookie,
    isSecureRequest,
    setAdminSessionCookie,
} from '../../../../../src/app/presentation/lib/admin-session-cookie.js';


describe('admin session cookie', ({ describe }) => {

    describe('isSecureRequest()', ({ it }) => {

        it('reports a secure request when the URL protocol is https', () => {
            assertEqual(true, isSecureRequest(makeRequest('https://example.com/admin')));
        });

        it('reports an insecure request over plain HTTP, so local development still works', () => {
            assertEqual(false, isSecureRequest(makeRequest('http://localhost:2026/admin')));
        });

        it('reports an insecure request for a non-HTTP protocol', () => {
            assertEqual(false, isSecureRequest(makeRequest('ftp://example.com/admin')));
        });
    });

    describe('setAdminSessionCookie()', ({ it }) => {

        it('sets a Secure cookie over HTTPS', () => {
            const response = makeResponse();
            setAdminSessionCookie(makeRequest('https://example.com/admin'), response, 'session-1');

            assertEqual(1, response.cookies.length);
            assertEqual(ADMIN_SESSION_COOKIE_NAME, response.cookies[0].name);
            assertEqual('session-1', response.cookies[0].value);
            assertEqual(true, response.cookies[0].options.secure);
        });

        it('omits Secure over plain HTTP, which would otherwise drop the cookie', () => {
            const response = makeResponse();
            setAdminSessionCookie(makeRequest('http://localhost:2026/admin'), response, 'session-1');

            assertEqual(false, response.cookies[0].options.secure);
        });
    });

    describe('clearAdminSessionCookie()', ({ it }) => {

        it('clears with Secure over HTTPS', () => {
            const response = makeResponse();
            const request = makeRequest('https://example.com/admin', 'session-1');
            clearAdminSessionCookie(request, response);

            assertEqual(1, response.cookies.length);
            assertEqual('', response.cookies[0].value);
            assertEqual(0, response.cookies[0].options.maxAge);
            assertEqual(true, response.cookies[0].options.secure);
        });

        it('clears without Secure over plain HTTP', () => {
            const response = makeResponse();
            const request = makeRequest('http://localhost:2026/admin', 'session-1');
            clearAdminSessionCookie(request, response);

            assertEqual(false, response.cookies[0].options.secure);
        });

        it('does nothing when there is no session cookie to clear', () => {
            const response = makeResponse();
            clearAdminSessionCookie(makeRequest('https://example.com/admin'), response);

            assertFalsy(response.cookies.length);
        });
    });
});

function makeRequest(url, sessionId) {
    return {
        url: new URL(url),
        getCookie(name) {
            return name === ADMIN_SESSION_COOKIE_NAME ? sessionId : null;
        },
    };
}

function makeResponse() {
    const cookies = [];

    return {
        cookies,
        setCookie(name, value, options) {
            cookies.push({ name, value, options });
        },
    };
}
