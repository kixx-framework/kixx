import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertMatches,
} from 'kixx-assert';

import ServerRequest from '../../../../../src/plugins/node-server-request/lib/server-request.js';
import serverRequestConformance from '../../../kixx/http-router/server-request-conformance.js';


// Build a stand-in for http.IncomingMessage: a Readable stream carrying the body
// bytes, plus the method/url/headers/socket fields the adapter reads. Header keys
// are lowercased to match Node's IncomingMessage behavior.
function makeIncoming(options) {
    const opts = options ?? {};

    const headers = {};
    const rawHeaders = Object.assign({ host: 'www.example.com' }, opts.headers ?? {});
    for (const [ key, value ] of Object.entries(rawHeaders)) {
        headers[ key.toLowerCase() ] = value;
    }

    const hasBody = opts.body !== undefined;

    // Frame the body so the adapter detects it, unless the caller set framing.
    if (hasBody && headers['content-length'] === undefined && headers['transfer-encoding'] === undefined) {
        headers['content-length'] = String(Buffer.byteLength(opts.body));
    }

    const incoming = hasBody ? Readable.from([ Buffer.from(opts.body) ]) : Readable.from([]);
    incoming.method = opts.method ?? 'GET';
    // `path` is the conformance suite's request-target option; `url` is the
    // equivalent used by the platform-specific tests below.
    incoming.url = opts.url ?? opts.path ?? '/';
    incoming.headers = headers;
    // remoteAddress mirrors the TCP peer address Node exposes on the socket; the
    // adapter falls back to it when no X-Forwarded-For header is present.
    incoming.socket = { encrypted: Boolean(opts.encrypted), remoteAddress: opts.remoteAddress };

    return incoming;
}

// Satisfies the conformance suite's factory contract. Node takes a request
// target plus a Host header rather than an absolute URL, and makeIncoming
// supplies the default Host.
function makeServerRequest(options) {
    const opts = options ?? {};
    // trustProxy rides on the same options bag for convenience but is a
    // constructor option, not part of the IncomingMessage built by makeIncoming.
    return new ServerRequest(makeIncoming(opts), { trustProxy: opts.trustProxy });
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


describe('Node ServerRequest', ({ describe }) => {

    // The platform-independent contract, shared with every other adapter.
    serverRequestConformance(describe, makeServerRequest);

    describe('id', ({ it }) => {
        it('uses the x-request-id header when present', () => {
            const request = makeServerRequest({ headers: { 'x-request-id': 'req-abc-123' } });

            assertEqual('req-abc-123', request.id);
        });

        it('falls back to a generated id when x-request-id is absent', () => {
            const request = makeServerRequest();

            assertMatches(/^kixx-node-/, request.id);
        });

        it('generates a distinct fallback id per request', () => {
            const first = makeServerRequest();
            const second = makeServerRequest();

            assert(first.id !== second.id, 'expected fallback ids to differ');
        });

        it('falls back to a generated id when repeated x-request-id values are empty', () => {
            const request = makeServerRequest({ headers: { 'x-request-id': [ '', '' ] } });

            assertMatches(/^kixx-node-/, request.id);
        });

        it('is immutable after construction', () => {
            const request = makeServerRequest({ headers: { 'x-request-id': 'req-1' } });

            const caught = catchError(() => {
                request.id = 'tampered';
            });

            assertEqual('TypeError', caught.name);
            assertEqual('req-1', request.id);
        });
    });

    describe('core properties', ({ it }) => {
        it('uppercases the HTTP method', () => {
            const request = new ServerRequest(makeIncoming({ method: 'post', body: '{}', headers: { 'content-type': 'application/json' } }));

            assertEqual('POST', request.method);
        });

        it('reconstructs the URL from the request target and Host header', () => {
            const request = makeServerRequest({ url: '/items?id=9', headers: { host: 'shop.example.com' } });

            assertEqual('http', request.url.protocol.replace(':', ''));
            assertEqual('shop.example.com', request.url.hostname);
            assertEqual('/items', request.url.pathname);
            assertEqual('9', request.url.searchParams.get('id'));
        });

        it('honors X-Forwarded-Proto for the scheme', () => {
            const request = makeServerRequest({ url: '/', headers: { 'x-forwarded-proto': 'https' } });

            assertEqual('https:', request.url.protocol);
        });

        it('honors the first non-empty X-Forwarded-Proto value when repeated', () => {
            const request = makeServerRequest({ url: '/', headers: { 'x-forwarded-proto': [ '', 'https' ] } });

            assertEqual('https:', request.url.protocol);
        });

        it('uses https when the socket is encrypted and no forwarded proto is set', () => {
            const request = makeServerRequest({ url: '/', encrypted: true });

            assertEqual('https:', request.url.protocol);
        });

        it('resolves the authority from the HTTP/2 :authority pseudo-header', () => {
            const request = makeServerRequest({ url: '/', headers: { ':authority': 'h2.example.com', host: 'ignored.example.com' } });

            assertEqual('h2.example.com', request.url.hostname);
        });

        it('exposes a Web Headers instance with case-insensitive access', () => {
            const request = makeServerRequest({ headers: { 'X-Custom': 'yes' } });

            assert(request.headers instanceof Headers);
            assertEqual('yes', request.headers.get('x-custom'));
        });

        it('excludes HTTP/2 pseudo-headers from the headers set', () => {
            const request = makeServerRequest({ url: '/', headers: { ':authority': 'h2.example.com' } });

            // ':authority' is an invalid Web Headers name, so verify exclusion by
            // confirming no stamped header name carries the pseudo-header colon.
            const names = Array.from(request.headers.keys());
            assertFalsy(names.some((name) => name.startsWith(':')));
        });

        it('appends repeated header values rather than replacing them', () => {
            const request = makeServerRequest({ headers: { 'x-multi': [ 'one', 'two' ] } });

            assertEqual('one, two', request.headers.get('x-multi'));
        });
    });

    describe('ip', ({ describe, it }) => {

        describe('when trustProxy is disabled (the default)', ({ it }) => {
            it('uses the socket remote address', () => {
                const request = makeServerRequest({ remoteAddress: '203.0.113.7' });

                assertEqual('203.0.113.7', request.ip);
            });

            it('ignores X-Forwarded-For and uses the socket remote address', () => {
                const request = makeServerRequest({
                    remoteAddress: '10.0.0.1',
                    headers: { 'x-forwarded-for': '203.0.113.7' },
                });

                assertEqual('10.0.0.1', request.ip);
            });

            it('ignores X-Forwarded-For and returns null when there is no socket address', () => {
                const request = makeServerRequest({
                    headers: { 'x-forwarded-for': '203.0.113.7' },
                });

                assertEqual(null, request.ip);
            });

            it('returns null when neither X-Forwarded-For nor a socket address is available', () => {
                const request = makeServerRequest();

                assertEqual(null, request.ip);
            });

            it('treats an explicit trustProxy: false the same as unset', () => {
                const request = makeServerRequest({
                    trustProxy: false,
                    remoteAddress: '10.0.0.1',
                    headers: { 'x-forwarded-for': '203.0.113.7' },
                });

                assertEqual('10.0.0.1', request.ip);
            });
        });

        describe('when trustProxy is enabled', ({ it }) => {
            it('prefers the leftmost X-Forwarded-For entry over the socket address', () => {
                const request = makeServerRequest({
                    trustProxy: true,
                    remoteAddress: '10.0.0.1',
                    headers: { 'x-forwarded-for': '203.0.113.7' },
                });

                assertEqual('203.0.113.7', request.ip);
            });

            it('returns the original client (leftmost) from a multi-hop X-Forwarded-For list', () => {
                const request = makeServerRequest({
                    trustProxy: true,
                    remoteAddress: '10.0.0.1',
                    headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.101, 198.51.100.102' },
                });

                assertEqual('203.0.113.7', request.ip);
            });

            it('trims surrounding whitespace from the X-Forwarded-For value', () => {
                const request = makeServerRequest({
                    trustProxy: true,
                    headers: { 'x-forwarded-for': '  203.0.113.7  , 198.51.100.101' },
                });

                assertEqual('203.0.113.7', request.ip);
            });

            it('falls back to the socket remote address when X-Forwarded-For is absent', () => {
                const request = makeServerRequest({
                    trustProxy: true,
                    remoteAddress: '10.0.0.1',
                });

                assertEqual('10.0.0.1', request.ip);
            });

            it('returns null when there is neither an X-Forwarded-For nor a socket address', () => {
                const request = makeServerRequest({ trustProxy: true });

                assertEqual(null, request.ip);
            });
        });

        it('is immutable after construction', () => {
            const request = makeServerRequest({ remoteAddress: '203.0.113.7' });

            const caught = catchError(() => {
                request.ip = '10.0.0.9';
            });

            assertEqual('TypeError', caught.name);
            assertEqual('203.0.113.7', request.ip);
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

        it('returns null for a POST framed with neither Content-Length nor Transfer-Encoding', () => {
            // makeIncoming only adds Content-Length when a body is supplied, so an
            // unframed POST exercises the hasRequestBody() guard directly.
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'application/json' },
            });

            assertEqual(null, request.body);
        });

        it('wraps a mid-stream read failure in BadRequestError', async () => {
            // A body that fails partway through is the operational half of the
            // read-error split: unlike a double read, it is the client's
            // transfer that broke, so it must still surface as a 400. Only a
            // Node stream can be made to fail this way, which is why this case
            // lives here rather than in the shared conformance suite.
            const incoming = makeIncoming({
                method: 'POST',
                headers: { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' },
                body: 'partial',
            });

            const failing = new Readable({
                read() {
                    this.destroy(new Error('socket reset'));
                },
            });
            failing.method = incoming.method;
            failing.url = incoming.url;
            failing.headers = incoming.headers;
            failing.socket = incoming.socket;

            const request = new ServerRequest(failing);

            const caught = await catchAsyncError(() => request.arrayBuffer());

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assert(caught.cause, 'expected the original error to be preserved as cause');
        });
    });
});
