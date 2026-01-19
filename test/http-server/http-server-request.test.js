import { EventEmitter } from 'node:events';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import HttpServerRequest from '../../lib/http-server/http-server-request.js';


/**
 * Creates a mock Node.js IncomingMessage for testing.
 * Extends EventEmitter to support stream events (data, end, error).
 */
function createMockNodeRequest(options = {}) {
    const {
        method = 'GET',
        headers = {},
    } = options;

    const req = new EventEmitter();
    req.method = method;
    req.headers = headers;
    return req;
}


describe('HttpServerRequest#constructor', ({ it }) => {
    const mockReq = createMockNodeRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
    });
    const url = new URL('https://example.com/users/123?foo=bar');
    const id = 'test-request-id';

    const request = new HttpServerRequest(mockReq, url, id);

    it('sets the id property', () => {
        assertEqual(id, request.id);
    });

    it('sets the method property', () => {
        assertEqual('POST', request.method);
    });

    it('sets the url property', () => {
        assertEqual(url, request.url);
    });

    it('creates a Headers instance from request headers', () => {
        assert(request.headers instanceof Headers);
        assertEqual('application/json', request.headers.get('content-type'));
    });

    it('makes id non-writable', () => {
        let error;
        try {
            request.id = 'new-id';
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });

    it('makes method non-writable', () => {
        let error;
        try {
            request.method = 'DELETE';
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpServerRequest#hostnameParams default', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns an empty frozen object by default', () => {
        const params = request.hostnameParams;
        assertEqual(0, Object.keys(params).length);
        assert(Object.isFrozen(params));
    });
});


describe('HttpServerRequest#pathnameParams default', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns an empty frozen object by default', () => {
        const params = request.pathnameParams;
        assertEqual(0, Object.keys(params).length);
        assert(Object.isFrozen(params));
    });
});


describe('HttpServerRequest#queryParams with single values', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/?name=john&age=30');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns query parameters as an object', () => {
        const params = request.queryParams;
        assertEqual('john', params.name);
        assertEqual('30', params.age);
    });
});


describe('HttpServerRequest#queryParams with duplicate keys', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/?tags=red&tags=blue&tags=green');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns array for duplicate keys', () => {
        const params = request.queryParams;
        assert(Array.isArray(params.tags));
        assertEqual(3, params.tags.length);
        assertEqual('red', params.tags[0]);
        assertEqual('blue', params.tags[1]);
        assertEqual('green', params.tags[2]);
    });
});


describe('HttpServerRequest#queryParams with no query string', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/path');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns empty object', () => {
        const params = request.queryParams;
        assertEqual(0, Object.keys(params).length);
    });
});


describe('HttpServerRequest#isHeadRequest() when method is HEAD', ({ it }) => {
    const mockReq = createMockNodeRequest({ method: 'HEAD' });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns true', () => {
        assertEqual(true, request.isHeadRequest());
    });
});


describe('HttpServerRequest#isHeadRequest() when method is not HEAD', ({ it }) => {
    const mockReq = createMockNodeRequest({ method: 'GET' });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns false', () => {
        assertEqual(false, request.isHeadRequest());
    });
});


describe('HttpServerRequest#isJSONRequest() with JSON content-type', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'content-type': 'application/json' },
    });
    const url = new URL('https://example.com/api/users');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns true', () => {
        assertEqual(true, request.isJSONRequest());
    });
});


describe('HttpServerRequest#isJSONRequest() with .json extension', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/api/users.json');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns true', () => {
        assertEqual(true, request.isJSONRequest());
    });
});


describe('HttpServerRequest#isJSONRequest() with JSON accept header', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { accept: 'application/json' },
    });
    const url = new URL('https://example.com/api/users');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns true', () => {
        assertEqual(true, request.isJSONRequest());
    });
});


describe('HttpServerRequest#isJSONRequest() with no JSON indicators', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'content-type': 'text/html', accept: 'text/html' },
    });
    const url = new URL('https://example.com/page');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns false', () => {
        assertEqual(false, request.isJSONRequest());
    });
});


describe('HttpServerRequest#isFormURLEncodedRequest() with form content-type', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const url = new URL('https://example.com/submit');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns true', () => {
        assertEqual(true, request.isFormURLEncodedRequest());
    });
});


describe('HttpServerRequest#isFormURLEncodedRequest() with other content-type', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'content-type': 'application/json' },
    });
    const url = new URL('https://example.com/submit');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns false', () => {
        assertEqual(false, request.isFormURLEncodedRequest());
    });
});


describe('HttpServerRequest#setPathnameParams()', ({ before, it }) => {
    let request;
    let result;

    before(() => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://example.com/users/123');
        request = new HttpServerRequest(mockReq, url, 'test-id');
        result = request.setPathnameParams({ id: '123' });
    });

    it('sets the pathname parameters', () => {
        assertEqual('123', request.pathnameParams.id);
    });

    it('returns the request instance for chaining', () => {
        assertEqual(request, result);
    });
});


describe('HttpServerRequest#setHostnameParams()', ({ before, it }) => {
    let request;
    let result;

    before(() => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://acme.example.com/');
        request = new HttpServerRequest(mockReq, url, 'test-id');
        result = request.setHostnameParams({ tenant: 'acme' });
    });

    it('sets the hostname parameters', () => {
        assertEqual('acme', request.hostnameParams.tenant);
    });

    it('returns the request instance for chaining', () => {
        assertEqual(request, result);
    });
});


describe('HttpServerRequest#getCookie() when cookie exists', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { cookie: 'sessionId=abc123; theme=dark' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns the cookie value', () => {
        assertEqual('abc123', request.getCookie('sessionId'));
        assertEqual('dark', request.getCookie('theme'));
    });
});


describe('HttpServerRequest#getCookie() when cookie does not exist', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { cookie: 'sessionId=abc123' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.getCookie('nonexistent'));
    });
});


describe('HttpServerRequest#getCookie() when no cookies present', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.getCookie('sessionId'));
    });
});


describe('HttpServerRequest#getCookies() parses cookie header', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { cookie: 'sessionId=abc123; theme=dark; lang=en' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns object with all cookies', () => {
        const cookies = request.getCookies();
        assertEqual('abc123', cookies.sessionId);
        assertEqual('dark', cookies.theme);
        assertEqual('en', cookies.lang);
    });
});


describe('HttpServerRequest#getCookies() handles equals signs in values', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { cookie: 'data=user=john&role=admin' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('preserves equals signs in cookie value', () => {
        const cookies = request.getCookies();
        assertEqual('user=john&role=admin', cookies.data);
    });
});


describe('HttpServerRequest#getCookies() with no cookie header', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.getCookies());
    });
});


describe('HttpServerRequest#getAuthorizationBearer() with valid Bearer token', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiIs' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns the token without Bearer prefix', () => {
        assertEqual('eyJhbGciOiJIUzI1NiIs', request.getAuthorizationBearer());
    });
});


describe('HttpServerRequest#getAuthorizationBearer() case-insensitive scheme', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { authorization: 'BEARER mytoken123' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('accepts uppercase BEARER', () => {
        assertEqual('mytoken123', request.getAuthorizationBearer());
    });
});


describe('HttpServerRequest#getAuthorizationBearer() with Basic auth', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null for non-Bearer schemes', () => {
        assertEqual(null, request.getAuthorizationBearer());
    });
});


describe('HttpServerRequest#getAuthorizationBearer() with no authorization header', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.getAuthorizationBearer());
    });
});


describe('HttpServerRequest#getAuthorizationBearer() with missing token', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { authorization: 'Bearer' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.getAuthorizationBearer());
    });
});


describe('HttpServerRequest#ifModifiedSince with valid date', ({ it }) => {
    const dateString = 'Wed, 21 Oct 2015 07:28:00 GMT';
    const mockReq = createMockNodeRequest({
        headers: { 'if-modified-since': dateString },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns parsed Date object', () => {
        const result = request.ifModifiedSince;
        assert(result instanceof Date);
        assertEqual(new Date(dateString).getTime(), result.getTime());
    });
});


describe('HttpServerRequest#ifModifiedSince with invalid date', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'if-modified-since': 'not-a-valid-date' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.ifModifiedSince);
    });
});


describe('HttpServerRequest#ifModifiedSince with no header', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.ifModifiedSince);
    });
});


describe('HttpServerRequest#ifNoneMatch with quoted ETag', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'if-none-match': '"abc123"' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns ETag without quotes', () => {
        assertEqual('abc123', request.ifNoneMatch);
    });
});


describe('HttpServerRequest#ifNoneMatch with multiple ETags', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'if-none-match': '"first", "second", "third"' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns first ETag without quotes', () => {
        assertEqual('first', request.ifNoneMatch);
    });
});


describe('HttpServerRequest#ifNoneMatch with unquoted ETag', ({ it }) => {
    const mockReq = createMockNodeRequest({
        headers: { 'if-none-match': 'unquoted123' },
    });
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns ETag as-is', () => {
        assertEqual('unquoted123', request.ifNoneMatch);
    });
});


describe('HttpServerRequest#ifNoneMatch with no header', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns null', () => {
        assertEqual(null, request.ifNoneMatch);
    });
});


describe('HttpServerRequest#getReadStream()', ({ it }) => {
    const mockReq = createMockNodeRequest();
    const url = new URL('https://example.com/');
    const request = new HttpServerRequest(mockReq, url, 'test-id');

    it('returns the underlying node request', () => {
        assertEqual(mockReq, request.getReadStream());
    });
});


describe('HttpServerRequest#json() parses JSON body', ({ before, it }) => {
    let request;
    let result;

    before(async () => {
        const mockReq = createMockNodeRequest({
            headers: { 'content-type': 'application/json' },
        });
        const url = new URL('https://example.com/api');
        request = new HttpServerRequest(mockReq, url, 'test-id');

        // Simulate async data events
        setTimeout(() => {
            mockReq.emit('data', Buffer.from('{"name":'));
            mockReq.emit('data', Buffer.from('"John","age":30}'));
            mockReq.emit('end');
        }, 0);

        result = await request.json();
    });

    it('returns parsed JSON object', () => {
        assertEqual('John', result.name);
        assertEqual(30, result.age);
    });
});


describe('HttpServerRequest#json() throws BadRequestError for invalid JSON', ({ it }) => {
    it('throws BadRequestError', async () => {
        const mockReq = createMockNodeRequest({
            headers: { 'content-type': 'application/json' },
        });
        const url = new URL('https://example.com/api');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('not valid json'));
            mockReq.emit('end');
        }, 0);

        let error;
        try {
            await request.json();
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('BadRequestError', error.name);
    });
});


describe('HttpServerRequest#json() caches result', ({ before, it }) => {
    let request;
    let result1;
    let result2;

    before(async () => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://example.com/api');
        request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('{"cached":true}'));
            mockReq.emit('end');
        }, 0);

        result1 = await request.json();
        result2 = await request.json();
    });

    it('returns same data on subsequent calls', () => {
        assertEqual(true, result1.cached);
        assertEqual(true, result2.cached);
    });
});


describe('HttpServerRequest#formData() parses form body', ({ before, it }) => {
    let result;

    before(async () => {
        const mockReq = createMockNodeRequest({
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        const url = new URL('https://example.com/submit');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('name=John&age=30'));
            mockReq.emit('end');
        }, 0);

        result = await request.formData();
    });

    it('returns parsed form data', () => {
        assertEqual('John', result.name);
        assertEqual('30', result.age);
    });
});


describe('HttpServerRequest#formData() handles duplicate keys', ({ before, it }) => {
    let result;

    before(async () => {
        const mockReq = createMockNodeRequest({
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        const url = new URL('https://example.com/submit');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('tags=red&tags=blue&tags=green'));
            mockReq.emit('end');
        }, 0);

        result = await request.formData();
    });

    it('collects duplicate keys into arrays', () => {
        assert(Array.isArray(result.tags));
        assertEqual(3, result.tags.length);
        assertEqual('red', result.tags[0]);
        assertEqual('blue', result.tags[1]);
        assertEqual('green', result.tags[2]);
    });
});


describe('HttpServerRequest#formData() handles URL encoding', ({ before, it }) => {
    let result;

    before(async () => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://example.com/submit');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('message=Hello%20World%21'));
            mockReq.emit('end');
        }, 0);

        result = await request.formData();
    });

    it('decodes URL-encoded values', () => {
        assertEqual('Hello World!', result.message);
    });
});


describe('HttpServerRequest#getBufferedData() buffers stream data', ({ before, it }) => {
    let result;

    before(async () => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://example.com/');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('chunk1'));
            mockReq.emit('data', Buffer.from('chunk2'));
            mockReq.emit('end');
        }, 0);

        result = await request.getBufferedData();
    });

    it('returns complete Buffer', () => {
        assert(Buffer.isBuffer(result));
        assertEqual('chunk1chunk2', result.toString('utf8'));
    });
});


describe('HttpServerRequest#getBufferedData() handles stream errors', ({ it }) => {
    it('rejects with stream error', async () => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://example.com/');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        const streamError = new Error('Stream failed');

        setTimeout(() => {
            mockReq.emit('error', streamError);
        }, 0);

        let error;
        try {
            await request.getBufferedData();
        } catch (err) {
            error = err;
        }

        assert(error);
        assertEqual('Stream failed', error.message);
    });
});


describe('HttpServerRequest#getBufferedData() caches result', ({ before, it }) => {
    let result1;
    let result2;

    before(async () => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://example.com/');
        const request = new HttpServerRequest(mockReq, url, 'test-id');

        setTimeout(() => {
            mockReq.emit('data', Buffer.from('cached data'));
            mockReq.emit('end');
        }, 0);

        result1 = await request.getBufferedData();
        result2 = await request.getBufferedData();
    });

    it('returns same Buffer on subsequent calls', () => {
        assertEqual(result1, result2);
    });
});


describe('HttpServerRequest method chaining', ({ before, it }) => {
    let request;

    before(() => {
        const mockReq = createMockNodeRequest();
        const url = new URL('https://tenant.example.com/users/123');
        request = new HttpServerRequest(mockReq, url, 'test-id');

        request
            .setHostnameParams({ tenant: 'acme' })
            .setPathnameParams({ id: '123' });
    });

    it('supports chaining setHostnameParams and setPathnameParams', () => {
        assertEqual('acme', request.hostnameParams.tenant);
        assertEqual('123', request.pathnameParams.id);
    });
});
