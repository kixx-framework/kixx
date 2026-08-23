import {
    assert,
    assertEqual,
    assertFalsy,
    assertValidDate,
} from 'kixx-assert';

/**
 * @callback MakeServerRequest
 * @param {Object} [options]
 * @param {string} [options.method='GET'] - HTTP method.
 * @param {string} [options.path='/'] - Request target: pathname plus optional query string.
 * @param {Object<string, string>} [options.headers] - Request headers.
 * @param {string} [options.body] - Request body; the factory frames it for its platform.
 * @returns {Object} A platform ServerRequest built from those options.
 */

/**
 * The shared ServerRequest contract suite, run against every platform adapter.
 *
 * This suite covers only behavior that `BaseServerRequest` implements, which is
 * identical on every deploy target. Running it against each real adapter — not
 * against a fake subclass — is what proves the shipped adapters satisfy the
 * contract, and makes a regression in hoisted behavior fail on both platforms
 * at once instead of being caught on whichever one happened to be tested.
 *
 * Platform-specific derivation (`id`, `ip`, `url`, `headers`, body framing)
 * belongs in the adapter's own test file, not here.
 *
 * Call it from inside an adapter's top-level `describe` callback, passing that
 * callback's nested `describe` handle. kixx-test reports the full block path,
 * so the enclosing platform name identifies which adapter failed.
 *
 * The factory absorbs the one shape difference between platforms: an edge
 * adapter needs an absolute URL, while a Node adapter takes a request target
 * plus a Host header. The suite therefore never constructs a URL itself.
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block.
 * @param {MakeServerRequest} makeServerRequest - Builds the adapter under test.
 */
export default function serverRequestConformance(describe, makeServerRequest) {

    describe('contract: queryParams', ({ it }) => {
        it('returns a string for a single-valued key', () => {
            const request = makeServerRequest({ path: '/?q=hello' });

            assertEqual('hello', request.queryParams.q);
        });

        it('returns an array for a repeated key', () => {
            const request = makeServerRequest({ path: '/?tag=a&tag=b' });

            assertEqual('a,b', request.queryParams.tag.join(','));
        });

        it('returns an empty object when there is no query string', () => {
            const request = makeServerRequest({ path: '/path' });

            assertEqual(0, Object.keys(request.queryParams).length);
        });
    });

    describe('contract: hostnameParams and pathnameParams defaults', ({ it }) => {
        it('default to empty immutable objects at construction', () => {
            const request = makeServerRequest();

            assertEqual(0, Object.keys(request.hostnameParams).length);
            assertEqual(0, Object.keys(request.pathnameParams).length);
            assert(Object.isFrozen(request.hostnameParams));
            assert(Object.isFrozen(request.pathnameParams));
        });
    });

    describe('contract: setPathnameParams', ({ it }) => {
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

    describe('contract: setHostnameParams', ({ it }) => {
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

    describe('contract: isHeadRequest', ({ it }) => {
        it('is true for a HEAD request', () => {
            const request = makeServerRequest({ method: 'HEAD' });

            assert(request.isHeadRequest());
        });

        it('is false for a non-HEAD request', () => {
            const request = makeServerRequest({ method: 'GET' });

            assertFalsy(request.isHeadRequest());
        });
    });

    describe('contract: isFormURLEncodedRequest', ({ it }) => {
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

    describe('contract: getContentMediaType', ({ it }) => {
        it('returns the content media type without parameters', () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'text/html; charset=utf-8' },
                body: '<h1>Hello</h1>',
            });

            assertEqual('text/html', request.getContentMediaType());
        });

        it('trims and lowercases the content media type', () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': ' Text/Plain ; charset=utf-8' },
                body: 'hello',
            });

            assertEqual('text/plain', request.getContentMediaType());
        });

        it('returns an empty string when the Content-Type header is absent', () => {
            const request = makeServerRequest();

            assertEqual('', request.getContentMediaType());
        });
    });

    describe('contract: getCookies', ({ it }) => {
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

    describe('contract: getCookie', ({ it }) => {
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

    describe('contract: getAuthorizationBearer', ({ it }) => {
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

    describe('contract: ifModifiedSince', ({ it }) => {
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

    describe('contract: ifNoneMatch', ({ it }) => {
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

        it('preserves a comma inside a quoted strong ETag', () => {
            const request = makeServerRequest({ headers: { 'if-none-match': '"first,still-first", "second"' } });

            assertEqual('first,still-first', request.ifNoneMatch);
        });
    });

    describe('contract: json', ({ it }) => {
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

    describe('contract: text', ({ it }) => {
        it('decodes the body as a UTF-8 string', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'text/plain; charset=utf-8' },
                body: 'hello wörld',
            });

            assertEqual('hello wörld', await request.text());
        });

        it('resolves to an empty string for a bodyless request', async () => {
            const request = makeServerRequest();

            assertEqual('', await request.text());
        });
    });

    describe('contract: formData', ({ it }) => {
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
            const boundary = '----kixxBoundary';
            // Build the multipart payload by hand so the same bytes and the same
            // explicit boundary are exercised on every platform.
            const body = [
                `--${ boundary }`,
                'Content-Disposition: form-data; name="name"',
                '',
                'kris',
                `--${ boundary }--`,
                '',
            ].join('\r\n');

            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': `multipart/form-data; boundary=${ boundary }` },
                body,
            });

            const form = await request.formData();

            assertEqual('kris', form.get('name'));
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
