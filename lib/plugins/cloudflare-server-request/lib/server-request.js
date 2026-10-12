import BaseServerRequest from '../../../kixx/http-router/base-server-request.js';

let serverRequestSequence = 0;

/**
 * Wraps a Cloudflare Workers `Request` with the Kixx HTTP router request contract.
 *
 * Workers hands the adapter a Web `Request`, which already provides a parsed
 * URL, a `Headers` instance, and the body surface the base class delegates to.
 * The platform-specific work is therefore limited to the two values Cloudflare
 * expresses through its own headers:
 *
 * - `id` is the Cloudflare Ray ID (`cf-ray`) when present, falling back to a
 *   per-process value for local worker runtimes that omit the header.
 * - `ip` comes from `CF-Connecting-IP`, or the Enterprise-only
 *   `True-Client-IP`. `X-Forwarded-For` is deliberately ignored.
 *
 * @implements {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface}
 * @extends BaseServerRequest
 */
export default class ServerRequest extends BaseServerRequest {

    /**
     * @param {Request} nativeRequest - Cloudflare Workers request to adapt
     */
    constructor(nativeRequest) {
        super({
            id: getRequestId(nativeRequest),
            ip: resolveClientIp(nativeRequest),
            method: nativeRequest.method.toUpperCase(),
            url: new URL(nativeRequest.url),
            headers: nativeRequest.headers,
            // The native Request already exposes the Web body surface, so it
            // serves as the body delegate directly.
            bodyDelegate: nativeRequest,
        });
    }
}

// Cloudflare injects the client IP via CF-Connecting-IP on all proxied traffic;
// True-Client-IP is the Enterprise-only equivalent and serves as a fallback.
// X-Forwarded-For is intentionally ignored: Cloudflare's own guidance directs
// origins to read CF-Connecting-IP / True-Client-IP instead, since XFF can
// carry client-supplied hops.
function resolveClientIp(nativeRequest) {
    const cfConnectingIp = (nativeRequest.headers.get('cf-connecting-ip') ?? '').trim();
    if (cfConnectingIp) {
        return cfConnectingIp;
    }

    const trueClientIp = (nativeRequest.headers.get('true-client-ip') ?? '').trim();
    if (trueClientIp) {
        return trueClientIp;
    }

    return null;
}

function getRequestId(nativeRequest) {
    const cfRay = nativeRequest.headers.get('cf-ray');
    if (cfRay) {
        return cfRay;
    }

    serverRequestSequence += 1;

    // Local worker test environments do not always provide Cloudflare's cf-ray header.
    return `kixx-cf-${Date.now().toString(36)}-${serverRequestSequence.toString(36)}`;
}
