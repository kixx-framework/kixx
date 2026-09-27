import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
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

    // `chunks` delivers the body in several reads, so a test can stop partway.
    const hasBody = opts.body !== undefined || opts.chunks !== undefined;
    const chunks = (opts.chunks ?? (hasBody ? [ opts.body ] : [])).map((chunk) => Buffer.from(chunk));

    // Frame the body so the adapter detects it, unless the caller set framing.
    if (hasBody && headers['content-length'] === undefined && headers['transfer-encoding'] === undefined) {
        headers['content-length'] = String(Buffer.concat(chunks).byteLength);
    }

    const incoming = Readable.from(chunks);
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

// Resolves when the source emits 'end', which proves the whole body was read
// off the source. A destroyed source emits 'close' without 'end'.
function waitForEnd(readable) {
    return new Promise((resolve, reject) => {
        readable.once('end', resolve);
        readable.once('close', () => {
            if (!readable.readableEnded) {
                reject(new Error('source closed without ending'));
            }
        });
    });
}

// Sends POSTs over one raw TCP connection, each only after the previous
// response arrived, and resolves with the response status lines. A raw socket
// is used because Node's http client abandons keep-alive when a response
// arrives before its request body is sent, which would hide server behavior.
function postSequentially(port, byteLengths, responseBody) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let received = '';
        let responseCount = 0;

        const sendNext = () => {
            const byteLength = byteLengths[responseCount];
            socket.write(`POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${ byteLength }\r\n\r\n`);
            socket.write(Buffer.alloc(byteLength));
        };

        const onClose = () => {
            reject(new Error(`socket closed after ${ responseCount } responses`));
        };

        socket.setEncoding('latin1');
        socket.on('connect', sendNext);
        socket.on('error', reject);
        socket.on('close', onClose);

        socket.on('data', (data) => {
            received += data;

            // Every response ends with the same short body, so counting it
            // counts complete responses.
            const count = received.split(responseBody).length - 1;
            if (count === responseCount) {
                return;
            }

            responseCount = count;

            if (responseCount < byteLengths.length) {
                sendNext();
                return;
            }

            socket.off('close', onClose);
            socket.destroy();
            resolve(received.match(/HTTP\/1\.1 \d{3}/g));
        });
    });
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

        it('resumes the source instead of destroying it when the body is cancelled', async () => {
            // Destroying the IncomingMessage would reset the client socket.
            const incoming = makeIncoming({ method: 'POST', chunks: [ 'a', 'b', 'c' ] });
            const request = new ServerRequest(incoming);
            const ended = waitForEnd(incoming);

            await request.body.cancel();
            await ended;

            assertFalsy(incoming.destroyed && !incoming.readableEnded);
            assertEqual(0, incoming.listenerCount('data'));
        });
    });

    describe('discardUnreadBody()', ({ it }) => {
        it('drains the rest of a partially read body', async () => {
            const incoming = makeIncoming({ method: 'POST', chunks: [ 'a', 'b', 'c' ] });
            const request = new ServerRequest(incoming);
            const ended = waitForEnd(incoming);

            const { value } = await request.body.getReader().read();
            assertEqual('a', Buffer.from(value).toString());

            request.discardUnreadBody();
            await ended;

            assertEqual(0, incoming.listenerCount('data'));
        });

        it('drains a body that was never read', async () => {
            const incoming = makeIncoming({ method: 'POST', chunks: [ 'a', 'b', 'c' ] });
            const request = new ServerRequest(incoming);
            const ended = waitForEnd(incoming);

            request.discardUnreadBody();
            await ended;

            assertEqual(0, incoming.listenerCount('data'));
        });

        it('leaves a fully read body intact', async () => {
            const request = makeServerRequest({
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                chunks: [ 'a', 'b', 'c' ],
            });

            assertEqual('abc', await request.text());

            request.discardUnreadBody();
            request.discardUnreadBody();
        });

        it('is a no-op for a bodyless request', () => {
            const request = makeServerRequest({ method: 'GET' });

            request.discardUnreadBody();

            assertEqual(null, request.body);
        });

        it('is safe to call more than once', async () => {
            const incoming = makeIncoming({ method: 'POST', chunks: [ 'a', 'b', 'c' ] });
            const request = new ServerRequest(incoming);
            const ended = waitForEnd(incoming);

            request.discardUnreadBody();
            request.discardUnreadBody();
            await ended;
        });
    });

    describe('with a real Node HTTP server', ({ before, after, it }) => {
        const LARGE_BODY_BYTES = 2 * 1024 * 1024;

        const RESPONSE_BODY = 'too large';

        const serverRequestsEnded = [];
        let server;
        let port;

        before(async () => {
            // Mirrors node-server.js: an early 413 without reading the body, with
            // the discard registered on response finish. The short delay makes
            // the response async, as a real router is.
            server = http.createServer((nativeRequest, nativeResponse) => {
                serverRequestsEnded.push(once(nativeRequest, 'end'));

                const request = new ServerRequest(nativeRequest);
                nativeResponse.once('finish', () => request.discardUnreadBody());

                setTimeout(() => {
                    nativeResponse.statusCode = 413;
                    nativeResponse.end(RESPONSE_BODY);
                }, 20);
            });

            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            port = server.address().port;
        });

        after(async () => {
            server.closeAllConnections();
            server.close();
            await once(server, 'close');
        });

        it('drains an unread body so the connection serves the next request', async () => {
            // Without the discard, the server never reads past the first body,
            // so the second response never arrives and the test times out.
            const statusLines = await postSequentially(port, [ LARGE_BODY_BYTES, 10 ], RESPONSE_BODY);

            assertEqual(2, statusLines.length);
            assertEqual('HTTP/1.1 413', statusLines[0]);
            assertEqual('HTTP/1.1 413', statusLines[1]);

            // Both bodies were read to the end, not abandoned.
            await Promise.all(serverRequestsEnded);
        });
    }, { timeout: 5000 });
});
