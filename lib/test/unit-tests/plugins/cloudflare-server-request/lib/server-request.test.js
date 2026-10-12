import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
} from 'kixx-assert';

import ServerRequest from '../../../../../src/plugins/cloudflare-server-request/lib/server-request.js';
import serverRequestConformance from '../../../kixx/http-router/server-request-conformance.js';


const ORIGIN = 'https://www.example.com';


function makeNativeRequest(options) {
    const opts = options ?? {};
    const url = opts.url ?? `${ ORIGIN }${ opts.path ?? '/' }`;
    const init = { method: opts.method ?? 'GET', headers: opts.headers ?? {} };

    // GET/HEAD requests cannot carry a body, so only attach one when provided.
    if (opts.body !== undefined) {
        init.body = opts.body;
    }

    return new Request(url, init);
}

// Satisfies the conformance suite's factory contract. Workers needs an absolute
// URL, so a `path` from the suite is resolved against a fixed origin.
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


describe('Cloudflare ServerRequest', ({ describe }) => {

    // The platform-independent contract, shared with every other adapter.
    serverRequestConformance(describe, makeServerRequest);

    describe('id', ({ it }) => {
        it('uses the cf-ray header when present', () => {
            const request = makeServerRequest({ headers: { 'cf-ray': '8a1b2c3d4e5f-IAD' } });

            assertEqual('8a1b2c3d4e5f-IAD', request.id);
        });

        it('falls back to a generated id when cf-ray is absent', () => {
            const request = makeServerRequest();

            assert(request.id.startsWith('kixx-cf-'), 'expected a kixx-cf- prefixed fallback id');
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

    describe('ip', ({ it }) => {
        it('uses the CF-Connecting-IP header', () => {
            const request = makeServerRequest({ headers: { 'cf-connecting-ip': '203.0.113.7' } });

            assertEqual('203.0.113.7', request.ip);
        });

        it('falls back to True-Client-IP when CF-Connecting-IP is absent', () => {
            const request = makeServerRequest({ headers: { 'true-client-ip': '203.0.113.8' } });

            assertEqual('203.0.113.8', request.ip);
        });

        it('prefers CF-Connecting-IP over True-Client-IP when both are present', () => {
            const request = makeServerRequest({
                headers: { 'cf-connecting-ip': '203.0.113.7', 'true-client-ip': '203.0.113.8' },
            });

            assertEqual('203.0.113.7', request.ip);
        });

        it('returns null and ignores X-Forwarded-For when no Cloudflare header is present', () => {
            const request = makeServerRequest({ headers: { 'x-forwarded-for': '203.0.113.7' } });

            assertEqual(null, request.ip);
        });

        it('is immutable after construction', () => {
            const request = makeServerRequest({ headers: { 'cf-connecting-ip': '203.0.113.7' } });

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
    });

    describe('formData', ({ it }) => {
        it('parses a multipart body whose boundary the runtime supplied', async () => {
            const form = new FormData();
            form.append('name', 'kris');

            // Passing a FormData body lets the runtime set the multipart
            // content-type (with boundary) automatically. The conformance suite
            // covers a hand-built payload; this covers the runtime-built one.
            const request = new ServerRequest(new Request(`${ ORIGIN }/`, {
                method: 'POST',
                body: form,
            }));

            const parsed = await request.formData();

            assertEqual('kris', parsed.get('name'));
        });
    });
});
