import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertMatches,
    assertValidDate,
} from 'kixx-assert';

import ServerRequest from '../../../../src/kixx/cloudflare/http-router/server-request.js';


function makeNativeRequest(options) {
    const opts = options ?? {};
    const url = opts.url ?? 'https://www.example.com/';
    const init = { method: opts.method ?? 'GET', headers: opts.headers ?? {} };

    // GET/HEAD requests cannot carry a body, so only attach one when provided.
    if (opts.body !== undefined) {
        init.body = opts.body;
    }

    return new Request(url, init);
}

function makeServerRequest(options) {
    return new ServerRequest(makeNativeRequest(options));
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Cloudflare ServerRequest', ({ describe }) => {

    describe('id', ({ it }) => {
        it('uses the cf-ray header when present', () => {
            const request = makeServerRequest({ headers: { 'cf-ray': '8a1b2c3d4e5f-IAD' } });

            assertEqual('8a1b2c3d4e5f-IAD', request.id);
        });

        it('falls back to a generated id when cf-ray is absent', () => {
            const request = makeServerRequest();

            assertMatches(/^kixx-cf-/, request.id);
        });

        it('generates a distinct fallback id per request', () => {
            const first = makeServerRequest();
            const second = makeServerRequest();

            assert(first.id !== second.id, 'expected fallback ids to differ');
        });

        it('is immutable after construction', () => {
            const request = makeServerRequest({ headers: { 'cf-ray': 'ray-1' } });

            const caught = catchError(() => {
                request.id = 'tampered';
            });

            assertEqual('TypeError', caught.name);
            assertEqual('ray-1', request.id);
        });
    });

    describe('core properties', ({ it }) => {
        it('uppercases the HTTP method', () => {
            const request = new ServerRequest(makeNativeRequest({ method: 'post' }));

            assertEqual('POST', request.method);
        });

        it('exposes a fully parsed URL', () => {
            const request = makeServerRequest({ url: 'https://shop.example.com/items?id=9' });

            assertEqual('shop.example.com', request.url.hostname);
            assertEqual('/items', request.url.pathname);
            assertEqual('9', request.url.searchParams.get('id'));
        });

        it('exposes the native headers with case-insensitive access', () => {
            const request = makeServerRequest({ headers: { 'X-Custom': 'yes' } });

            assert(request.headers instanceof Headers);
            assertEqual('yes', request.headers.get('x-custom'));
        });
    });

    describe('body', ({ it }) => {
        it('returns a ReadableStream for a request with a body', () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: 'hello',
            });

            assert(request.body instanceof ReadableStream);
        });

        it('returns null for a bodyless request', () => {
            const request = makeServerRequest();

            assertEqual(null, request.body);
        });
    });

    describe('hostnameParams and pathnameParams defaults', ({ it }) => {
        it('default to empty immutable objects at construction', () => {
            const request = makeServerRequest();

            assertEqual(0, Object.keys(request.hostnameParams).length);
            assertEqual(0, Object.keys(request.pathnameParams).length);
            assert(Object.isFrozen(request.hostnameParams));
            assert(Object.isFrozen(request.pathnameParams));
        });
    });

    describe('setPathnameParams', ({ it }) => {
        it('returns this for chaining', () => {
            const request = makeServerRequest();

            assertEqual(request, request.setPathnameParams({ id: '1' }));
        });

        it('exposes the stamped string params', () => {
            const request = makeServerRequest();

            request.setPathnameParams({ id: '42' });

            assertEqual('42', request.pathnameParams.id);
        });

        it('stores a clone so later mutation of the source has no effect', () => {
            const request = makeServerRequest();
            const source = { id: '42' };

            request.setPathnameParams(source);
            source.id = 'mutated';

            assertEqual('42', request.pathnameParams.id);
        });

        it('returns a stable object identity across reads', () => {
            const request = makeServerRequest();

            request.setPathnameParams({ id: '42' });

            assertEqual(request.pathnameParams, request.pathnameParams);
        });

        it('preserves wildcard params as arrays', () => {
            const request = makeServerRequest();

            request.setPathnameParams({ path: [ 'a', 'b', 'c' ] });

            assertEqual('a,b,c', request.pathnameParams.path.join(','));
        });

        it('deep-freezes so a wildcard array param cannot be mutated', () => {
            const request = makeServerRequest();

            request.setPathnameParams({ path: [ 'a', 'b' ] });

            assert(Object.isFrozen(request.pathnameParams.path));

            const pushed = catchError(() => request.pathnameParams.path.push('c'));
            assertEqual('TypeError', pushed.name);

            const assigned = catchError(() => {
                request.pathnameParams.path[0] = 'z';
            });
            assertEqual('TypeError', assigned.name);

            assertEqual('a,b', request.pathnameParams.path.join(','));
        });

        it('freezes the top-level params object against reassignment', () => {
            const request = makeServerRequest();

            request.setPathnameParams({ id: '42' });

            const caught = catchError(() => {
                request.pathnameParams.id = 'changed';
            });

            assertEqual('TypeError', caught.name);
        });
    });

    describe('setHostnameParams', ({ it }) => {
        it('returns this for chaining', () => {
            const request = makeServerRequest();

            assertEqual(request, request.setHostnameParams({ tenant: 'acme' }));
        });

        it('exposes the stamped params and deep-freezes nested values', () => {
            const request = makeServerRequest();

            request.setHostnameParams({ tenant: 'acme', labels: [ 'www', 'eu' ] });

            assertEqual('acme', request.hostnameParams.tenant);
            assert(Object.isFrozen(request.hostnameParams.labels));

            const caught = catchError(() => request.hostnameParams.labels.push('x'));
            assertEqual('TypeError', caught.name);
        });
    });

    describe('queryParams', ({ it }) => {
        it('returns a string for a single-valued key', () => {
            const request = makeServerRequest({ url: 'https://www.example.com/?q=hello' });

            assertEqual('hello', request.queryParams.q);
        });

        it('returns an array for a repeated key', () => {
            const request = makeServerRequest({ url: 'https://www.example.com/?tag=a&tag=b' });

            assertEqual('a,b', request.queryParams.tag.join(','));
        });

        it('returns an empty object when there is no query string', () => {
            const request = makeServerRequest({ url: 'https://www.example.com/path' });

            assertEqual(0, Object.keys(request.queryParams).length);
        });
    });

    describe('isHeadRequest', ({ it }) => {
        it('is true for a HEAD request', () => {
            const request = makeServerRequest({ method: 'HEAD' });

            assert(request.isHeadRequest());
        });

        it('is false for a non-HEAD request', () => {
            const request = makeServerRequest({ method: 'GET' });

            assertFalsy(request.isHeadRequest());
        });
    });

    describe('isJSONRequest', ({ it }) => {
        it('is true when the pathname ends with .json', () => {
            const request = makeServerRequest({ url: 'https://www.example.com/users/42.json' });

            assert(request.isJSONRequest());
        });

        it('is true when the Accept header includes application/json', () => {
            const request = makeServerRequest({ headers: { accept: 'text/html, application/json' } });

            assert(request.isJSONRequest());
        });

        it('is false when neither the path nor the Accept header requests JSON', () => {
            const request = makeServerRequest({ headers: { accept: 'text/html' } });

            assertFalsy(request.isJSONRequest());
        });
    });

    describe('isFormURLEncodedRequest', ({ it }) => {
        it('is true for a urlencoded content type, ignoring parameters', () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
                body: 'a=1',
            });

            assert(request.isFormURLEncodedRequest());
        });

        it('is false for a non-urlencoded content type', () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });

            assertFalsy(request.isFormURLEncodedRequest());
        });
    });

    describe('getCookies', ({ it }) => {
        it('returns null when the Cookie header is absent', () => {
            const request = makeServerRequest();

            assertEqual(null, request.getCookies());
        });

        it('parses multiple cookies into a name/value map', () => {
            const request = makeServerRequest({ headers: { cookie: 'sid=abc; theme=dark' } });

            const cookies = request.getCookies();

            assertEqual('abc', cookies.sid);
            assertEqual('dark', cookies.theme);
        });

        it('preserves equals signs within a cookie value', () => {
            const request = makeServerRequest({ headers: { cookie: 'data=user=john&role=admin' } });

            assertEqual('user=john&role=admin', request.getCookies().data);
        });
    });

    describe('getCookie', ({ it }) => {
        it('returns the named cookie value', () => {
            const request = makeServerRequest({ headers: { cookie: 'sid=abc; theme=dark' } });

            assertEqual('abc', request.getCookie('sid'));
        });

        it('returns null when the named cookie is absent', () => {
            const request = makeServerRequest({ headers: { cookie: 'sid=abc' } });

            assertEqual(null, request.getCookie('theme'));
        });

        it('returns null when there is no Cookie header', () => {
            const request = makeServerRequest();

            assertEqual(null, request.getCookie('sid'));
        });
    });

    describe('getAuthorizationBearer', ({ it }) => {
        it('returns the token from a Bearer authorization header', () => {
            const request = makeServerRequest({ headers: { authorization: 'Bearer abc.def.ghi' } });

            assertEqual('abc.def.ghi', request.getAuthorizationBearer());
        });

        it('matches the Bearer scheme case-insensitively', () => {
            const request = makeServerRequest({ headers: { authorization: 'bearer abc.def.ghi' } });

            assertEqual('abc.def.ghi', request.getAuthorizationBearer());
        });

        it('returns null when the header is absent', () => {
            const request = makeServerRequest();

            assertEqual(null, request.getAuthorizationBearer());
        });

        it('returns null for a non-Bearer scheme', () => {
            const request = makeServerRequest({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });

            assertEqual(null, request.getAuthorizationBearer());
        });

        it('returns null for a malformed token with embedded whitespace', () => {
            const request = makeServerRequest({ headers: { authorization: 'Bearer two tokens' } });

            assertEqual(null, request.getAuthorizationBearer());
        });
    });

    describe('ifModifiedSince', ({ it }) => {
        it('returns a Date for a valid header value', () => {
            const value = 'Wed, 21 Oct 2015 07:28:00 GMT';
            const request = makeServerRequest({ headers: { 'if-modified-since': value } });

            assertValidDate(request.ifModifiedSince);
            assertEqual(new Date(value), request.ifModifiedSince);
        });

        it('returns null when the header is absent', () => {
            const request = makeServerRequest();

            assertEqual(null, request.ifModifiedSince);
        });

        it('returns null when the header is an unparseable date', () => {
            const request = makeServerRequest({ headers: { 'if-modified-since': 'not-a-date' } });

            assertEqual(null, request.ifModifiedSince);
        });
    });

    describe('ifNoneMatch', ({ it }) => {
        it('returns null when the header is absent', () => {
            const request = makeServerRequest();

            assertEqual(null, request.ifNoneMatch);
        });

        it('strips surrounding quotes from a strong ETag', () => {
            const request = makeServerRequest({ headers: { 'if-none-match': '"abc123"' } });

            assertEqual('abc123', request.ifNoneMatch);
        });

        it('returns a weak ETag unchanged', () => {
            const request = makeServerRequest({ headers: { 'if-none-match': 'W/"abc123"' } });

            assertEqual('W/"abc123"', request.ifNoneMatch);
        });

        it('returns the first ETag when several are present', () => {
            const request = makeServerRequest({ headers: { 'if-none-match': '"first", "second"' } });

            assertEqual('first', request.ifNoneMatch);
        });
    });

    describe('json', ({ it }) => {
        it('parses a valid JSON body', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true, n: 7 }),
            });

            const result = await request.json();

            assertEqual(true, result.ok);
            assertEqual(7, result.n);
        });

        it('rejects with BadRequestError on invalid JSON', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{ not valid json',
            });

            const caught = await catchAsyncError(() => request.json());

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });
    });

    describe('formData', ({ it }) => {
        it('parses a urlencoded form body', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: 'name=kris&role=admin',
            });

            const form = await request.formData();

            assertEqual('kris', form.get('name'));
            assertEqual('admin', form.get('role'));
        });

        it('parses a multipart form body', async () => {
            const form = new FormData();
            form.append('name', 'kris');

            // Passing a FormData body lets the runtime set the multipart
            // content-type (with boundary) automatically.
            const request = new ServerRequest(new Request('https://www.example.com/', {
                method: 'POST',
                body: form,
            }));

            const parsed = await request.formData();

            assertEqual('kris', parsed.get('name'));
        });

        it('rejects with UnsupportedMediaTypeError for an unsupported content type', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });

            const caught = await catchAsyncError(() => request.formData());

            assert(caught, 'expected an error to be thrown');
            assertEqual('UnsupportedMediaTypeError', caught.name);
        });

        it('rejects with BadRequestError when the body cannot be parsed as form data', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'multipart/form-data; boundary=----kixxBoundary' },
                body: 'this is not a valid multipart payload',
            });

            const caught = await catchAsyncError(() => request.formData());

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });
    });
});
