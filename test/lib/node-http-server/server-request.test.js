import { Readable } from 'node:stream';
import { describe } from 'kixx-test';
import { assertEqual, assertMatches, assertArray } from 'kixx-assert';
import ServerRequest from '../../../lib/node-http-server/server-request.js';


function createMockReq(overrides = {}) {
    return {
        method: 'GET',
        headers: {},
        ...overrides,
    };
}

function createMockReqWithBody(bodyChunks, headers = {}) {
    const stream = Readable.from(bodyChunks);
    stream.method = 'GET';
    stream.headers = headers;
    return stream;
}

describe('ServerRequest constructor', ({ it }) => {
    const url = new URL('https://example.com/path?foo=bar');
    const req = createMockReq({ method: 'POST', headers: { 'content-type': 'application/json' } });
    const request = new ServerRequest(req, url, 'req-123');

    it('sets id from constructor argument', () => assertEqual('req-123', request.id));
    it('sets method from req.method', () => assertEqual('POST', request.method));
    it('sets url from constructor argument', () => assertEqual(url, request.url));
    it('exposes headers as Web API Headers', () => {
        assertEqual('application/json', request.headers.get('content-type'));
    });
});

describe('ServerRequest#body when first accessed', ({ it }) => {
    const url = new URL('https://example.com/');
    const req = createMockReqWithBody([ Buffer.from('') ], {});
    const request = new ServerRequest(req, url, 'req-1');

    it('returns a ReadableStream', () => {
        const body = request.body;
        assertEqual('ReadableStream', body?.constructor?.name);
    });
});

describe('ServerRequest#body when accessed multiple times', ({ it }) => {
    const url = new URL('https://example.com/');
    const req = createMockReqWithBody([ Buffer.from('') ], {});
    const request = new ServerRequest(req, url, 'req-1');

    it('returns the same stream instance', () => {
        const body1 = request.body;
        const body2 = request.body;
        assertEqual(body1, body2);
    });
});

describe('ServerRequest#hostnameParams when not set', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns empty object', () => assertEqual(0, Object.keys(request.hostnameParams).length));
});

describe('ServerRequest#pathnameParams when not set', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns empty object', () => assertEqual(0, Object.keys(request.pathnameParams).length));
});

describe('ServerRequest#setPathnameParams()', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('sets pathname params and returns this', () => {
        const result = request.setPathnameParams({ id: '123', slug: 'hello' });
        assertEqual(request, result);
        assertEqual('123', request.pathnameParams.id);
        assertEqual('hello', request.pathnameParams.slug);
    });

    it('freezes the params object', () => {
        assertEqual(true, Object.isFrozen(request.pathnameParams));
    });
});

describe('ServerRequest#setHostnameParams()', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('sets hostname params and returns this', () => {
        const result = request.setHostnameParams({ tenant: 'acme' });
        assertEqual(request, result);
        assertEqual('acme', request.hostnameParams.tenant);
    });

    it('freezes the params object', () => {
        assertEqual(true, Object.isFrozen(request.hostnameParams));
    });
});

describe('ServerRequest#queryParams when URL has single value per key', ({ it }) => {
    const url = new URL('https://example.com/?foo=bar&baz=qux');
    const request = new ServerRequest(createMockReq(), url, 'req-1');

    it('returns object with string values', () => {
        const params = request.queryParams;
        assertEqual('bar', params.foo);
        assertEqual('qux', params.baz);
    });
});

describe('ServerRequest#queryParams when URL has duplicate keys', ({ it }) => {
    const url = new URL('https://example.com/?tag=a&tag=b&tag=c');
    const request = new ServerRequest(createMockReq(), url, 'req-1');

    it('returns object with array values for duplicate keys', () => {
        const params = request.queryParams;
        assertArray(params.tag);
        assertEqual(3, params.tag.length);
        assertEqual('a', params.tag[0]);
        assertEqual('b', params.tag[1]);
        assertEqual('c', params.tag[2]);
    });
});

describe('ServerRequest#queryParams when URL has no search string', ({ it }) => {
    const url = new URL('https://example.com/');
    const request = new ServerRequest(createMockReq(), url, 'req-1');

    it('returns empty object', () => assertEqual(0, Object.keys(request.queryParams).length));
});

describe('ServerRequest#isHeadRequest() when method is HEAD', ({ it }) => {
    const req = createMockReq({ method: 'HEAD' });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns true', () => assertEqual(true, request.isHeadRequest()));
});

describe('ServerRequest#isHeadRequest() when method is GET', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns false', () => assertEqual(false, request.isHeadRequest()));
});

describe('ServerRequest#isJSONRequest() when pathname ends with .json', ({ it }) => {
    const url = new URL('https://example.com/api/users.json');
    const request = new ServerRequest(createMockReq(), url, 'req-1');

    it('returns true', () => assertEqual(true, request.isJSONRequest()));
});

describe('ServerRequest#isJSONRequest() when Accept header includes application/json', ({ it }) => {
    const req = createMockReq({ headers: { accept: 'text/html, application/json' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns true', () => assertEqual(true, request.isJSONRequest()));
});

describe('ServerRequest#isJSONRequest() when neither path nor Accept indicates JSON', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns false', () => assertEqual(false, request.isJSONRequest()));
});

describe('ServerRequest#isFormURLEncodedRequest() when Content-Type is form-urlencoded', ({ it }) => {
    const req = createMockReq({ headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns true', () => assertEqual(true, request.isFormURLEncodedRequest()));
});

describe('ServerRequest#isFormURLEncodedRequest() when Content-Type is missing', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns false', () => assertEqual(false, request.isFormURLEncodedRequest()));
});

describe('ServerRequest#getCookies() when Cookie header is missing', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.getCookies()));
});

describe('ServerRequest#getCookies() when Cookie header is present', ({ it }) => {
    const req = createMockReq({ headers: { cookie: 'session=abc123; theme=dark' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns parsed cookie object', () => {
        const cookies = request.getCookies();
        assertEqual('abc123', cookies.session);
        assertEqual('dark', cookies.theme);
    });
});

describe('ServerRequest#getCookies() when cookie value contains equals sign', ({ it }) => {
    const req = createMockReq({ headers: { cookie: 'data=user=john&role=admin' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('preserves full value after first equals', () => {
        const cookies = request.getCookies();
        assertEqual('user=john&role=admin', cookies.data);
    });
});

describe('ServerRequest#getCookie() when cookie exists', ({ it }) => {
    const req = createMockReq({ headers: { cookie: 'session=abc123' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns the cookie value', () => assertEqual('abc123', request.getCookie('session')));
});

describe('ServerRequest#getCookie() when cookie does not exist', ({ it }) => {
    const req = createMockReq({ headers: { cookie: 'session=abc123' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.getCookie('other')));
});

describe('ServerRequest#getCookie() when no cookies present', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.getCookie('session')));
});

describe('ServerRequest#getAuthorizationBearer() when Authorization header is missing', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.getAuthorizationBearer()));
});

describe('ServerRequest#getAuthorizationBearer() when Authorization is Bearer token', ({ it }) => {
    const req = createMockReq({ headers: { authorization: 'Bearer my-token-123' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns token without Bearer prefix', () => assertEqual('my-token-123', request.getAuthorizationBearer()));
});

describe('ServerRequest#getAuthorizationBearer() when scheme is not Bearer', ({ it }) => {
    const req = createMockReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.getAuthorizationBearer()));
});

describe('ServerRequest#getAuthorizationBearer() when scheme is Bearer (case insensitive)', ({ it }) => {
    const req = createMockReq({ headers: { authorization: 'BEARER token-xyz' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns token', () => assertEqual('token-xyz', request.getAuthorizationBearer()));
});

describe('ServerRequest#ifModifiedSince when header is missing', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.ifModifiedSince));
});

describe('ServerRequest#ifModifiedSince when header is valid RFC 2822 date', ({ it }) => {
    const req = createMockReq({ headers: { 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns Date instance', () => {
        const dt = request.ifModifiedSince;
        assertEqual(true, dt instanceof Date);
        assertEqual(1445412480000, dt.getTime());
    });
});

describe('ServerRequest#ifModifiedSince when header is invalid date', ({ it }) => {
    const req = createMockReq({ headers: { 'if-modified-since': 'not-a-date' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.ifModifiedSince));
});

describe('ServerRequest#ifNoneMatch when header is missing', ({ it }) => {
    const request = new ServerRequest(createMockReq(), new URL('https://example.com/'), 'req-1');

    it('returns null', () => assertEqual(null, request.ifNoneMatch));
});

describe('ServerRequest#ifNoneMatch when header is strong ETag', ({ it }) => {
    const req = createMockReq({ headers: { 'if-none-match': '"abc123"' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns value without quotes', () => assertEqual('abc123', request.ifNoneMatch));
});

describe('ServerRequest#ifNoneMatch when header has multiple ETags', ({ it }) => {
    const req = createMockReq({ headers: { 'if-none-match': '"first", "second"' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns first ETag only', () => assertEqual('first', request.ifNoneMatch));
});

describe('ServerRequest#ifNoneMatch when header is weak ETag', ({ it }) => {
    const req = createMockReq({ headers: { 'if-none-match': 'W/"weak-123"' } });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('returns value as-is', () => assertEqual('W/"weak-123"', request.ifNoneMatch));
});

describe('ServerRequest#json() when body is valid JSON', ({ before, it }) => {
    const url = new URL('https://example.com/');
    const body = Buffer.from('{"a":1,"b":"two"}');
    const req = createMockReqWithBody([ body ], { 'content-type': 'application/json' });
    const request = new ServerRequest(req, url, 'req-1');
    let result;

    before(async () => {
        result = await request.json();
    });

    it('returns parsed object', () => {
        assertEqual(1, result.a);
        assertEqual('two', result.b);
    });
});

describe('ServerRequest#json() when body is invalid JSON', ({ it }) => {
    const url = new URL('https://example.com/');
    const body = Buffer.from('not json');
    const req = createMockReqWithBody([ body ], { 'content-type': 'application/json' });
    const request = new ServerRequest(req, url, 'req-1');

    it('throws BadRequestError', async () => {
        let error;
        try {
            await request.json();
        } catch (err) {
            error = err;
        }
        assertEqual('BadRequestError', error.name);
        assertMatches('Error parsing HTTP JSON body', error.message);
    });
});

describe('ServerRequest#json() when body is empty', ({ before, it }) => {
    const url = new URL('https://example.com/');
    const req = createMockReqWithBody([ Buffer.from('') ], { 'content-type': 'application/json' });
    const request = new ServerRequest(req, url, 'req-1');
    let error;

    before(async () => {
        try {
            await request.json();
        } catch (err) {
            error = err;
        }
    });

    it('throws BadRequestError', () => {
        assertEqual('BadRequestError', error.name);
    });
});

describe('ServerRequest headers when Node headers contain array value (set-cookie)', ({ it }) => {
    const req = createMockReq({
        headers: {
            'set-cookie': [ 'a=1', 'b=2' ],
        },
    });
    const request = new ServerRequest(req, new URL('https://example.com/'), 'req-1');

    it('appends each value to Headers', () => {
        const cookies = request.headers.getSetCookie();
        assertEqual(2, cookies.length);
        assertEqual('a=1', cookies[0]);
        assertEqual('b=2', cookies[1]);
    });
});

describe('ServerRequest#formData() when body is application/x-www-form-urlencoded', ({ before, it }) => {
    const url = new URL('https://example.com/');
    const body = Buffer.from('name=Alice&age=30');
    const req = createMockReqWithBody([ body ], { 'content-type': 'application/x-www-form-urlencoded' });
    const request = new ServerRequest(req, url, 'req-1');
    let formData;

    before(async () => {
        formData = await request.formData();
    });

    it('returns FormData with entries', () => {
        assertEqual('Alice', formData.get('name'));
        assertEqual('30', formData.get('age'));
    });
});
