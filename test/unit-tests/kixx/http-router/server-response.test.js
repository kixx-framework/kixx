import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
} from 'kixx-assert';

import ServerResponse from '../../../src/kixx/http-router/server-response.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function getCookie(response) {
    return response.headers.get('set-cookie');
}


describe('ServerResponse', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('initializes status, body, headers, and props', () => {
            const response = new ServerResponse();

            assertEqual(200, response.status);
            assertEqual(null, response.body);
            assert(response.headers instanceof Headers);
            assertEqual(0, Object.keys(response.props).length);
        });
    });

    describe('updateProps', ({ it }) => {
        it('deep merges and returns this for chaining', () => {
            const response = new ServerResponse();

            const returned = response.updateProps({ user: { id: 'u1' } });
            response.updateProps({ user: { role: 'admin' } });

            assertEqual(response, returned);
            assertEqual('u1', response.props.user.id);
            assertEqual('admin', response.props.user.role);
        });

        it('throws a WrappedError when the value cannot be cloned', () => {
            const response = new ServerResponse();

            const caught = catchError(() => response.updateProps({ handler() {} }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('WrappedError', caught.name);
        });
    });

    describe('setHeader and appendHeader', ({ it }) => {
        it('setHeader replaces the value and returns this', () => {
            const response = new ServerResponse();

            const returned = response.setHeader('x-test', 'one');
            response.setHeader('x-test', 'two');

            assertEqual(response, returned);
            assertEqual('two', response.headers.get('x-test'));
        });

        it('appendHeader accumulates values', () => {
            const response = new ServerResponse();

            response.appendHeader('x-test', 'one');
            response.appendHeader('x-test', 'two');

            assertEqual('one, two', response.headers.get('x-test'));
        });
    });

    describe('setCookie', ({ it }) => {
        it('applies Secure, HttpOnly, and SameSite=Lax by default', () => {
            const response = new ServerResponse();

            response.setCookie('sid', 'abc');

            const cookie = getCookie(response);
            assertMatches('sid=abc', cookie);
            assertMatches('Secure', cookie);
            assertMatches('HttpOnly', cookie);
            assertMatches('SameSite=Lax', cookie);
        });

        it('encodes the value with encodeURIComponent', () => {
            const response = new ServerResponse();

            response.setCookie('sid', 'a b/c');

            assertMatches('sid=a%20b%2Fc', getCookie(response));
        });

        it('includes Max-Age, Domain, and Path when provided', () => {
            const response = new ServerResponse();

            response.setCookie('sid', 'abc', { maxAge: 60, domain: '.example.com', path: '/app' });

            const cookie = getCookie(response);
            assertMatches('Max-Age=60', cookie);
            assertMatches('Domain=.example.com', cookie);
            assertMatches('Path=/app', cookie);
        });

        it('omits Secure and HttpOnly when explicitly disabled', () => {
            const response = new ServerResponse();

            response.setCookie('sid', 'abc', { secure: false, httpOnly: false });

            const cookie = getCookie(response);
            assertNotMatches('Secure', cookie);
            assertNotMatches('HttpOnly', cookie);
        });

        it('throws an AssertionError for an invalid cookie name', () => {
            const response = new ServerResponse();

            const caught = catchError(() => response.setCookie('bad name', 'v'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError for a non-numeric maxAge', () => {
            const response = new ServerResponse();

            const caught = catchError(() => response.setCookie('sid', 'v', { maxAge: 'soon' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('clearCookie', ({ it }) => {
        it('expires the cookie with Max-Age=0 and a default path', () => {
            const response = new ServerResponse();

            response.clearCookie('sid');

            const cookie = getCookie(response);
            assertMatches('sid=;', cookie);
            assertMatches('Max-Age=0', cookie);
            assertMatches('Path=/', cookie);
        });
    });

    describe('respond', ({ it }) => {
        it('sets status, headers, and body', () => {
            const response = new ServerResponse();

            const returned = response.respond(201, { 'x-test': 'yes' }, 'created');

            assertEqual(response, returned);
            assertEqual(201, response.status);
            assertEqual('yes', response.headers.get('x-test'));
            assertEqual('created', response.body);
        });

        it('leaves the body untouched when it is not provided', () => {
            const response = new ServerResponse();

            response.respond(204, { 'x-test': 'yes' });

            assertEqual(204, response.status);
            assertEqual(null, response.body);
        });

        it('accepts a Headers instance', () => {
            const response = new ServerResponse();

            response.respond(200, new Headers({ 'x-from': 'headers' }));

            assertEqual('headers', response.headers.get('x-from'));
        });

        it('throws a TypeError for an unsupported headers value', () => {
            const response = new ServerResponse();

            const caught = catchError(() => response.respond(200, 'nope'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
        });
    });

    describe('respondWithRedirect', ({ it }) => {
        it('sets the status and Location header', () => {
            const response = new ServerResponse();

            response.respondWithRedirect(302, '/login');

            assertEqual(302, response.status);
            assertEqual('/login', response.headers.get('location'));
        });

        it('accepts a URL instance for the location', () => {
            const response = new ServerResponse();

            response.respondWithRedirect(301, new URL('https://example.com/x'));

            assertEqual('https://example.com/x', response.headers.get('location'));
        });

        it('throws an AssertionError when statusCode is not a number', () => {
            const response = new ServerResponse();

            const caught = catchError(() => response.respondWithRedirect('302', '/x'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('respondWithJSON', ({ it }) => {
        it('serializes the body with content-type and content-length', () => {
            const response = new ServerResponse();

            response.respondWithJSON(200, { ok: true });

            assertEqual(200, response.status);
            assertEqual('application/json; charset=utf-8', response.headers.get('content-type'));
            assertEqual(String(new Blob([ response.body ]).size), response.headers.get('content-length'));
            assertEqual(true, JSON.parse(response.body).ok);
        });

        it('appends a trailing newline to the body', () => {
            const response = new ServerResponse();

            response.respondWithJSON(200, { ok: true });

            assertMatches(/\n$/, response.body);
        });

        it('indents output when whiteSpace is provided', () => {
            const response = new ServerResponse();

            response.respondWithJSON(200, { ok: true }, { whiteSpace: 2 });

            assertMatches('  "ok"', response.body);
        });

        it('throws an AssertionError when the value does not serialize', () => {
            const response = new ServerResponse();

            const caught = catchError(() => response.respondWithJSON(200, undefined));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('respondWithHTML', ({ it }) => {
        it('uses a text/html content type', () => {
            const response = new ServerResponse();

            response.respondWithHTML(200, '<h1>hi</h1>');

            assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
            assertEqual('<h1>hi</h1>', response.body);
        });
    });

    describe('respondWithUtf8', ({ it }) => {
        it('defaults to text/plain and appends the charset', () => {
            const response = new ServerResponse();

            response.respondWithUtf8(200, 'hello');

            assertEqual('text/plain; charset=utf-8', response.headers.get('content-type'));
        });

        it('sets content-length as a byte count for multi-byte text', () => {
            const response = new ServerResponse();

            // 'a' is 1 byte and the emoji is 4 UTF-8 bytes, so length 2 would be wrong.
            response.respondWithUtf8(200, 'a\u{1F600}');

            assertEqual('5', response.headers.get('content-length'));
        });

        it('strips parameters from a custom content type before adding charset', () => {
            const response = new ServerResponse();

            response.respondWithUtf8(200, 'a,b', { contentType: 'text/csv; foo=bar' });

            assertEqual('text/csv; charset=utf-8', response.headers.get('content-type'));
        });
    });

    describe('respondWithStream', ({ it }) => {
        it('sets the body to the stream with optional content headers', () => {
            const response = new ServerResponse();
            const stream = { readable: true };

            response.respondWithStream(200, stream, { contentType: 'application/octet-stream', contentLength: 1024 });

            assertEqual(stream, response.body);
            assertEqual('application/octet-stream', response.headers.get('content-type'));
            assertEqual('1024', response.headers.get('content-length'));
        });

        it('accepts a null stream for HEAD responses', () => {
            const response = new ServerResponse();

            response.respondWithStream(200, null);

            assertEqual(200, response.status);
            assertEqual(null, response.body);
        });
    });
});
