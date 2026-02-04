import { Readable } from 'node:stream';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import HttpServerResponse from '../../lib/http-server/http-server-response.js';


describe('HttpServerResponse#constructor', ({ it }) => {
    const id = 'test-request-id';
    const response = new HttpServerResponse(id);

    it('sets the id property', () => {
        assertEqual(id, response.id);
    });

    it('sets default status to 200', () => {
        assertEqual(200, response.status);
    });

    it('sets default body to null', () => {
        assertEqual(null, response.body);
    });

    it('creates a Headers instance', () => {
        assert(response.headers instanceof Headers);
    });

    it('makes id non-writable', () => {
        let error;
        try {
            response.id = 'new-id';
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });

    it('makes headers non-writable', () => {
        let error;
        try {
            response.headers = new Headers();
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpServerResponse#updateProps()', ({ before, it }) => {
    let response;
    let res;

    before(() => {
        response = new HttpServerResponse('test-id');
        res = response.updateProps({ foo: 'bar', nested: { a: 1 } });
    });

    it('merges properties into props', () => {
        assertEqual('bar', response.props.foo);
        assertEqual(1, response.props.nested.a);
    });

    it('deeply freezes the props object', () => {
        assert(Object.isFrozen(response.props));
        assert(Object.isFrozen(response.props.nested));
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, res);
    });
});


describe('HttpServerResponse#updateProps() with subsequent calls', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response
            .updateProps({ foo: 'bar', nested: { a: 1 } })
            .updateProps({ nested: { b: 2 } });
    });

    it('deep merges with existing props', () => {
        assertEqual('bar', response.props.foo);
        assertEqual(1, response.props.nested.a);
        assertEqual(2, response.props.nested.b);
    });
});


describe('HttpServerResponse#setHeader()', ({ before, it }) => {
    let response;
    let result;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.setHeader('content-type', 'text/plain');
    });

    it('sets the header value', () => {
        assertEqual('text/plain', response.headers.get('content-type'));
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#setHeader() replaces existing value', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response
            .setHeader('content-type', 'text/plain')
            .setHeader('content-type', 'application/json');
    });

    it('replaces the previous header value', () => {
        assertEqual('application/json', response.headers.get('content-type'));
    });
});


describe('HttpServerResponse#appendHeader()', ({ before, it }) => {
    let response;
    let result;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.appendHeader('set-cookie', 'foo=bar');
    });

    it('appends the header value', () => {
        assertEqual('foo=bar', response.headers.get('set-cookie'));
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#appendHeader() with multiple values', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response
            .appendHeader('set-cookie', 'foo=bar')
            .appendHeader('set-cookie', 'baz=qux');
    });

    it('combines multiple values', () => {
        const cookieHeader = response.headers.get('set-cookie');
        assert(cookieHeader.includes('foo=bar'));
        assert(cookieHeader.includes('baz=qux'));
    });
});


describe('HttpServerResponse#setCookie() with defaults', ({ before, it }) => {
    let response;
    let result;
    let cookieHeader;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.setCookie('session', 'abc123');
        cookieHeader = response.headers.get('set-cookie');
    });

    it('sets the cookie name and value', () => {
        assert(cookieHeader.startsWith('session=abc123'));
    });

    it('defaults to Secure', () => {
        assert(cookieHeader.includes('Secure'));
    });

    it('defaults to HttpOnly', () => {
        assert(cookieHeader.includes('HttpOnly'));
    });

    it('defaults to SameSite=Lax', () => {
        assert(cookieHeader.includes('SameSite=Lax'));
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#setCookie() with maxAge option', ({ before, it }) => {
    let cookieHeader;

    before(() => {
        const response = new HttpServerResponse('test-id');
        response.setCookie('session', 'abc123', { maxAge: 3600 });
        cookieHeader = response.headers.get('set-cookie');
    });

    it('includes Max-Age attribute', () => {
        assert(cookieHeader.includes('Max-Age=3600'));
    });
});


describe('HttpServerResponse#setCookie() with path option', ({ before, it }) => {
    let cookieHeader;

    before(() => {
        const response = new HttpServerResponse('test-id');
        response.setCookie('session', 'abc123', { path: '/admin' });
        cookieHeader = response.headers.get('set-cookie');
    });

    it('includes Path attribute', () => {
        assert(cookieHeader.includes('Path=/admin'));
    });
});


describe('HttpServerResponse#setCookie() with secure set to false', ({ before, it }) => {
    let cookieHeader;

    before(() => {
        const response = new HttpServerResponse('test-id');
        response.setCookie('session', 'abc123', { secure: false });
        cookieHeader = response.headers.get('set-cookie');
    });

    it('omits Secure attribute', () => {
        assertEqual(false, cookieHeader.includes('Secure'));
    });
});


describe('HttpServerResponse#setCookie() with httpOnly set to false', ({ before, it }) => {
    let cookieHeader;

    before(() => {
        const response = new HttpServerResponse('test-id');
        response.setCookie('session', 'abc123', { httpOnly: false });
        cookieHeader = response.headers.get('set-cookie');
    });

    it('omits HttpOnly attribute', () => {
        assertEqual(false, cookieHeader.includes('HttpOnly'));
    });
});


describe('HttpServerResponse#setCookie() with sameSite option', ({ before, it }) => {
    let cookieHeader;

    before(() => {
        const response = new HttpServerResponse('test-id');
        response.setCookie('session', 'abc123', { sameSite: 'Strict' });
        cookieHeader = response.headers.get('set-cookie');
    });

    it('uses provided SameSite value', () => {
        assert(cookieHeader.includes('SameSite=Strict'));
        assertEqual(false, cookieHeader.includes('SameSite=Lax'));
    });
});


describe('HttpServerResponse#respond() with all parameters', ({ before, it }) => {
    let response;
    let result;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.respond(201, { 'content-type': 'text/plain', 'x-custom': 'value' }, 'Hello');
    });

    it('sets the status code', () => {
        assertEqual(201, response.status);
    });

    it('sets headers from object', () => {
        assertEqual('text/plain', response.headers.get('content-type'));
        assertEqual('value', response.headers.get('x-custom'));
    });

    it('sets the body', () => {
        assertEqual('Hello', response.body);
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respond() with no parameters', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respond();
    });

    it('keeps default status of 200', () => {
        assertEqual(200, response.status);
    });

    it('keeps default body of null', () => {
        assertEqual(null, response.body);
    });
});


describe('HttpServerResponse#respond() with only statusCode', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respond(404);
    });

    it('sets the status code', () => {
        assertEqual(404, response.status);
    });

    it('keeps default body of null', () => {
        assertEqual(null, response.body);
    });
});


describe('HttpServerResponse#respond() with Headers instance', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        const headers = new Headers();
        headers.set('content-type', 'application/json');
        headers.set('x-request-id', '12345');
        response.respond(200, headers, '{}');
    });

    it('sets headers from Headers instance', () => {
        assertEqual('application/json', response.headers.get('content-type'));
        assertEqual('12345', response.headers.get('x-request-id'));
    });
});


describe('HttpServerResponse#respond() with array of tuples', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        const headers = [
            [ 'content-type', 'text/xml' ],
            [ 'cache-control', 'no-cache' ],
        ];
        response.respond(200, headers, '<xml/>');
    });

    it('sets headers from array of tuples', () => {
        assertEqual('text/xml', response.headers.get('content-type'));
        assertEqual('no-cache', response.headers.get('cache-control'));
    });

    it('sets the body', () => {
        assertEqual('<xml/>', response.body);
    });
});


describe('HttpServerResponse#respond() merges with existing headers', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.setHeader('x-existing', 'preserved');
        response.respond(200, { 'x-new': 'added' });
    });

    it('preserves existing headers', () => {
        assertEqual('preserved', response.headers.get('x-existing'));
    });

    it('adds new headers', () => {
        assertEqual('added', response.headers.get('x-new'));
    });
});


describe('HttpServerResponse#respond() with null body', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.body = 'previous body';
        response.respond(200, null, null);
    });

    it('explicitly sets body to null', () => {
        assertEqual(null, response.body);
    });
});


describe('HttpServerResponse#respond() with invalid statusCode type', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respond('200', { 'content-type': 'text/plain' }, 'body');
    });

    it('ignores non-number statusCode and keeps default', () => {
        assertEqual(200, response.status);
    });

    it('still sets headers', () => {
        assertEqual('text/plain', response.headers.get('content-type'));
    });

    it('still sets body', () => {
        assertEqual('body', response.body);
    });
});


describe('HttpServerResponse#respondWithRedirect() with string URL', ({ before, it }) => {
    let response;
    let result;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.respondWithRedirect(302, 'https://example.com/new-path');
    });

    it('sets the status code', () => {
        assertEqual(302, response.status);
    });

    it('sets the location header', () => {
        assertEqual('https://example.com/new-path', response.headers.get('location'));
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respondWithRedirect() with URL object', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        const url = new URL('https://example.com/new-path');
        response.respondWithRedirect(301, url);
    });

    it('extracts href from URL object', () => {
        assertEqual('https://example.com/new-path', response.headers.get('location'));
    });
});


describe('HttpServerResponse#respondWithRedirect() with invalid statusCode', ({ it }) => {
    it('throws AssertionError for non-number statusCode', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithRedirect('302', '/new-path');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondWithRedirect() with invalid newLocation', ({ it }) => {
    it('throws AssertionError for empty string', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithRedirect(302, '');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondWithJSON() basic usage', ({ before, it }) => {
    let response;
    let result;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.respondWithJSON(200, { message: 'hello' });
    });

    it('sets the status code', () => {
        assertEqual(200, response.status);
    });

    it('sets content-type to application/json', () => {
        assertEqual('application/json; charset=utf-8', response.headers.get('content-type'));
    });

    it('sets content-length header', () => {
        assert(response.headers.get('content-length'));
    });

    it('serializes the object as JSON body with trailing newline', () => {
        assertEqual('{"message":"hello"}\n', response.body);
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respondWithJSON() with integer whiteSpace', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respondWithJSON(200, { a: 1 }, { whiteSpace: 2 });
    });

    it('formats JSON with specified indentation', () => {
        assertEqual('{\n  "a": 1\n}\n', response.body);
    });
});


describe('HttpServerResponse#respondWithJSON() with truthy whiteSpace', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respondWithJSON(200, { a: 1 }, { whiteSpace: true });
    });

    it('formats JSON with 4-space indentation', () => {
        assertEqual('{\n    "a": 1\n}\n', response.body);
    });
});


describe('HttpServerResponse#respondWithJSON() with custom contentType', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respondWithJSON(200, { a: 1 }, { contentType: 'application/vnd.api+json' });
    });

    it('uses the custom content type', () => {
        assertEqual('application/vnd.api+json', response.headers.get('content-type'));
    });
});


describe('HttpServerResponse#respondWithJSON() with invalid statusCode', ({ it }) => {
    it('throws AssertionError', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithJSON('200', { message: 'hello' });
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondWithHTML() basic usage', ({ before, it }) => {
    let response;
    let result;
    const html = '<html><body>Hello</body></html>';

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.respondWithHTML(200, html);
    });

    it('sets the status code', () => {
        assertEqual(200, response.status);
    });

    it('sets content-type to text/html', () => {
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
    });

    it('sets content-length header', () => {
        assert(response.headers.get('content-length'));
    });

    it('sets the body', () => {
        assertEqual(html, response.body);
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respondWithHTML() with invalid statusCode', ({ it }) => {
    it('throws AssertionError', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithHTML('200', '<html></html>');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondWithHTML() with invalid body', ({ it }) => {
    it('throws AssertionError for empty string', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithHTML(200, '');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondWithUtf8() basic usage', ({ before, it }) => {
    let response;
    let result;
    const content = 'Hello, World!';

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.respondWithUtf8(200, content);
    });

    it('sets the status code', () => {
        assertEqual(200, response.status);
    });

    it('defaults content-type to text/html with charset', () => {
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
    });

    it('sets content-length header', () => {
        assertEqual('13', response.headers.get('content-length'));
    });

    it('sets the body', () => {
        assertEqual(content, response.body);
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respondWithUtf8() with custom contentType', ({ before, it }) => {
    let response;

    before(() => {
        response = new HttpServerResponse('test-id');
        response.respondWithUtf8(200, 'plain text', { contentType: 'text/plain' });
    });

    it('appends charset to custom content type', () => {
        assertEqual('text/plain; charset=utf-8', response.headers.get('content-type'));
    });
});


describe('HttpServerResponse#respondWithUtf8() with invalid statusCode', ({ it }) => {
    it('throws AssertionError', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithUtf8('200', 'content');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondWithUtf8() with invalid body', ({ it }) => {
    it('throws AssertionError for empty string', () => {
        const response = new HttpServerResponse('test-id');
        let error;

        try {
            response.respondWithUtf8(200, '');
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#respondNotModified()', ({ before, it }) => {
    let response;
    let result;

    before(() => {
        response = new HttpServerResponse('test-id');
        result = response.respondNotModified();
    });

    it('sets status to 304', () => {
        assertEqual(304, response.status);
    });

    it('sets content-length to 0', () => {
        assertEqual('0', response.headers.get('content-length'));
    });

    it('sets body to null', () => {
        assertEqual(null, response.body);
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respondWithStream() with contentLength', ({ before, it }) => {
    let response;
    let result;
    let stream;

    before(() => {
        response = new HttpServerResponse('test-id');
        stream = Readable.from([ 'hello' ]);
        result = response.respondWithStream(200, 5, stream);
    });

    it('sets the status code', () => {
        assertEqual(200, response.status);
    });

    it('sets content-length header', () => {
        assertEqual('5', response.headers.get('content-length'));
    });

    it('sets the body to the stream', () => {
        assertEqual(stream, response.body);
    });

    it('returns the response instance for chaining', () => {
        assertEqual(response, result);
    });
});


describe('HttpServerResponse#respondWithStream() without contentLength', ({ before, it }) => {
    let response;
    let stream;

    before(() => {
        response = new HttpServerResponse('test-id');
        stream = Readable.from([ 'hello' ]);
        response.respondWithStream(200, null, stream);
    });

    it('does not set content-length header', () => {
        // Headers.get() returns null for missing headers
        assertEqual(null, response.headers.get('content-length'));
    });

    it('sets the body to the stream', () => {
        assertEqual(stream, response.body);
    });
});


describe('HttpServerResponse#respondWithStream() with invalid statusCode', ({ it }) => {
    it('throws AssertionError', () => {
        const response = new HttpServerResponse('test-id');
        const stream = Readable.from([ 'hello' ]);
        let error;

        try {
            response.respondWithStream('200', 5, stream);
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


describe('HttpServerResponse#getContentLengthForUTF8() with ASCII string', ({ it }) => {
    const response = new HttpServerResponse('test-id');

    it('returns correct byte length for ASCII', () => {
        assertEqual(5, response.getContentLengthForUTF8('hello'));
    });
});


describe('HttpServerResponse#getContentLengthForUTF8() with multi-byte characters', ({ it }) => {
    const response = new HttpServerResponse('test-id');

    it('returns correct byte length for emoji', () => {
        // Emoji typically use 4 bytes in UTF-8
        const emoji = '😀';
        assertEqual(4, response.getContentLengthForUTF8(emoji));
    });

    it('returns correct byte length for mixed content', () => {
        // 'Hello ' (6 bytes) + '世界' (6 bytes, 3 each) = 12 bytes
        const mixed = 'Hello 世界';
        assertEqual(12, response.getContentLengthForUTF8(mixed));
    });
});


describe('HttpServerResponse method chaining', ({ it }) => {
    it('supports chaining multiple methods', () => {
        const response = new HttpServerResponse('test-id');

        const result = response
            .updateProps({ user: 'test' })
            .setHeader('x-custom', 'value')
            .setCookie('session', 'abc')
            .respondWithJSON(200, { status: 'ok' });

        assertEqual(response, result);
        assertEqual('test', response.props.user);
        assertEqual('value', response.headers.get('x-custom'));
        assert(response.headers.get('set-cookie').includes('session=abc'));
        assertEqual(200, response.status);
    });
});
