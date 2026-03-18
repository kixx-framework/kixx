/**
 * ServerRequest port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { Readable } from 'node:stream';
 *   import { testServerRequestConformance } from '../../../conformance/http-server-request.js';
 *   import ServerRequest from '../../../../lib/node-http-server/server-request.js';
 *
 *   testServerRequestConformance((spec) => {
 *       const url = spec.url || new URL('https://example.com/');
 *       let req;
 *       if (spec.bodyChunks) {
 *           req = Readable.from(spec.bodyChunks);
 *           req.method = spec.method || 'POST';
 *           req.headers = spec.headers || {};
 *       } else {
 *           req = { method: spec.method || 'GET', headers: spec.headers || {} };
 *       }
 *       return new ServerRequest(req, url, spec.id || 'req-conformance');
 *   });
 *
 * The factory receives a spec object describing the desired request shape:
 *   - id {string} — the request ID
 *   - method {string} — HTTP method (e.g. 'GET', 'POST')
 *   - url {URL} — the request URL
 *   - headers {Object<string, string>} — headers as plain key-value pairs
 *   - bodyChunks {Buffer[]} — body content for requests that need a readable body
 *
 * @module conformance/http-server-request
 */
import { describe } from 'kixx-test';
import { assertEqual, assertNonEmptyString } from 'kixx-assert';


/**
 * Registers ServerRequest port conformance tests against any adapter implementation.
 *
 * @param {function(spec: Object): import('../../lib/ports/http-server-request.js').ServerRequest} createRequest
 *   Factory that creates a fresh ServerRequest from the given spec.
 */
export function testServerRequestConformance(createRequest) {

    // ──────────────────────────────────────────────────────────────────────────
    // id
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - id must be the string given at construction', ({ it }) => {
        it('exposes the id', () => {
            const request = createRequest({ id: 'req-abc' });
            assertEqual('req-abc', request.id);
        });
    });

    describe('ServerRequest port - id must be immutable after construction', ({ it }) => {
        it('assignment does not change the id', () => {
            const request = createRequest({ id: 'req-original' });
            try {
                request.id = 'req-mutated';
            } catch {
                // Strict-mode throw on a non-writable property is acceptable
            }
            assertEqual('req-original', request.id);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // method
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - method must be the HTTP method in UPPERCASE', ({ it }) => {
        it('exposes the method', () => {
            const request = createRequest({ method: 'POST' });
            assertEqual('POST', request.method);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // url
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - url must be a fully parsed URL instance', ({ it }) => {
        const url = new URL('https://example.com/some/path?q=1');

        it('is a URL instance', () => {
            const request = createRequest({ url });
            assertEqual(url, request.url);
        });

        it('exposes hostname', () => {
            const request = createRequest({ url });
            assertNonEmptyString(request.url.hostname);
        });

        it('exposes pathname', () => {
            const request = createRequest({ url });
            assertNonEmptyString(request.url.pathname);
        });

        it('exposes searchParams', () => {
            const request = createRequest({ url });
            assertEqual('function', typeof request.url.searchParams.get);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // headers
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - headers must be a Web API Headers instance', ({ it }) => {
        it('headers has a case-insensitive get() method', () => {
            const request = createRequest({ headers: { 'Content-Type': 'application/json' } });
            // Web API Headers normalises header names to lowercase
            assertEqual('application/json', request.headers.get('content-type'));
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // body
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - body must be a Web API ReadableStream', ({ it }) => {
        it('body has a getReader method', () => {
            const request = createRequest({ bodyChunks: [ Buffer.from('hello') ] });
            assertEqual('function', typeof request.body.getReader);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // hostnameParams / pathnameParams initial state
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - hostnameParams must be an empty frozen object at construction', ({ it }) => {
        it('starts with no keys', () => {
            const request = createRequest({});
            assertEqual(0, Object.keys(request.hostnameParams).length);
        });

        it('is frozen', () => {
            const request = createRequest({});
            assertEqual(true, Object.isFrozen(request.hostnameParams));
        });
    });

    describe('ServerRequest port - pathnameParams must be an empty frozen object at construction', ({ it }) => {
        it('starts with no keys', () => {
            const request = createRequest({});
            assertEqual(0, Object.keys(request.pathnameParams).length);
        });

        it('is frozen', () => {
            const request = createRequest({});
            assertEqual(true, Object.isFrozen(request.pathnameParams));
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // setHostnameParams()
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - setHostnameParams() must return this for chaining', ({ it }) => {
        it('returns the same request instance', () => {
            const request = createRequest({});
            const result = request.setHostnameParams({ tenant: 'acme' });
            assertEqual(request, result);
        });
    });

    describe('ServerRequest port - setHostnameParams() must freeze a clone of the params', ({ it }) => {
        it('hostnameParams is frozen after setting', () => {
            const request = createRequest({});
            request.setHostnameParams({ tenant: 'acme' });
            assertEqual(true, Object.isFrozen(request.hostnameParams));
        });

        it('mutating the input object does not affect hostnameParams', () => {
            const request = createRequest({});
            const input = { tenant: 'acme' };
            request.setHostnameParams(input);
            input.tenant = 'mutated';
            assertEqual('acme', request.hostnameParams.tenant);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // setPathnameParams()
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - setPathnameParams() must return this for chaining', ({ it }) => {
        it('returns the same request instance', () => {
            const request = createRequest({});
            const result = request.setPathnameParams({ id: '42' });
            assertEqual(request, result);
        });
    });

    describe('ServerRequest port - setPathnameParams() must freeze a clone of the params', ({ it }) => {
        it('pathnameParams is frozen after setting', () => {
            const request = createRequest({});
            request.setPathnameParams({ id: '42' });
            assertEqual(true, Object.isFrozen(request.pathnameParams));
        });

        it('mutating the input object does not affect pathnameParams', () => {
            const request = createRequest({});
            const input = { id: '42' };
            request.setPathnameParams(input);
            input.id = 'mutated';
            assertEqual('42', request.pathnameParams.id);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // json()
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - json() must reject with BadRequestError on invalid JSON body', ({ before, it }) => {
        let error;

        before(async () => {
            const request = createRequest({ bodyChunks: [ Buffer.from('not json') ] });
            try {
                await request.json();
            } catch (err) {
                error = err;
            }
        });

        it('rejects with an error', () => assertEqual('object', typeof error));
        it('error.name is BadRequestError', () => assertEqual('BadRequestError', error.name));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ifModifiedSince
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - ifModifiedSince must be null when the header is absent', ({ it }) => {
        it('returns null', () => {
            const request = createRequest({});
            assertEqual(null, request.ifModifiedSince);
        });
    });

    describe('ServerRequest port - ifModifiedSince must be null when the header contains an invalid date', ({ it }) => {
        it('returns null', () => {
            const request = createRequest({ headers: { 'if-modified-since': 'not-a-date' } });
            assertEqual(null, request.ifModifiedSince);
        });
    });

    describe('ServerRequest port - ifModifiedSince must be a Date when the header contains a valid date', ({ it }) => {
        it('returns a Date instance', () => {
            const request = createRequest({
                headers: { 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' },
            });
            const dt = request.ifModifiedSince;
            assertEqual(true, dt instanceof Date);
            assertEqual(1445412480000, dt.getTime());
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ifNoneMatch
    // ──────────────────────────────────────────────────────────────────────────

    describe('ServerRequest port - ifNoneMatch must be null when the header is absent', ({ it }) => {
        it('returns null', () => {
            const request = createRequest({});
            assertEqual(null, request.ifNoneMatch);
        });
    });

    describe('ServerRequest port - ifNoneMatch must strip surrounding quotes from strong ETags', ({ it }) => {
        it('returns the ETag without quotes', () => {
            const request = createRequest({ headers: { 'if-none-match': '"abc123"' } });
            assertEqual('abc123', request.ifNoneMatch);
        });
    });

    describe('ServerRequest port - ifNoneMatch must return weak ETags as-is', ({ it }) => {
        it('returns the weak ETag unchanged', () => {
            const request = createRequest({ headers: { 'if-none-match': 'W/"weak-123"' } });
            assertEqual('W/"weak-123"', request.ifNoneMatch);
        });
    });
}
