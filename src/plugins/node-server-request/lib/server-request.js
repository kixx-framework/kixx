import { Readable } from 'node:stream';
import {
    isNonEmptyString,
    isString,
} from '../../../kixx/assertions/mod.js';
import BaseServerRequest from '../../../kixx/http-router/base-server-request.js';

let serverRequestSequence = 0;

/**
 * Wraps a Node.js `http.IncomingMessage` with the Kixx HTTP router request contract.
 *
 * Node's `IncomingMessage` provides none of the Web primitives the base class
 * operates on, so this adapter derives them all: a Web `Headers` instance, a
 * fully resolved `URL` (the incoming message only carries the path), and an
 * internal Web `Request` that bridges the Node body stream so the base class
 * can delegate `body`, `json()`, `text()`, and `formData()` to the platform's
 * spec-compliant parsing.
 *
 * Two values are derived from sources this adapter must judge for itself:
 *
 * - `id` is the upstream `X-Request-Id` when a proxy supplies one, otherwise a
 *   per-process fallback. Node has no Cloudflare `cf-ray` equivalent.
 * - `ip` is the transport peer address by default, and the leftmost
 *   `X-Forwarded-For` entry only when the operator opts in via `trustProxy`.
 *
 * @implements {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface}
 * @extends BaseServerRequest
 */
export default class ServerRequest extends BaseServerRequest {

    /**
     * @param {import('node:http').IncomingMessage} nativeRequest - Node request to adapt
     * @param {Object} [options]
     * @param {boolean} [options.trustProxy=false] - Trust the `X-Forwarded-For`
     *   header when resolving `ip`. Enable only when a trusted reverse proxy
     *   sets it; otherwise a direct client could spoof its own IP address.
     */
    constructor(nativeRequest, options) {
        const { trustProxy = false } = options ?? {};
        const method = nativeRequest.method.toUpperCase();
        const headers = buildHeaders(nativeRequest);
        const url = new URL(
            nativeRequest.url,
            `${ resolveProtocol(nativeRequest) }://${ resolveHost(nativeRequest) }`,
        );

        const requestInit = { method, headers };

        if (hasRequestBody(method, nativeRequest)) {
            // Bridge the Node Readable into a Web Request so body/json/formData
            // can delegate to the runtime's spec-compliant parsing (including
            // multipart). duplex:'half' is required when constructing a Request
            // with a stream body.
            requestInit.body = Readable.toWeb(nativeRequest);
            requestInit.duplex = 'half';
        }

        // The internal Request is a body-parsing delegate only; headers, url,
        // method, and id are derived independently above so the contract is not
        // subject to the Request constructor stripping forbidden request headers
        // (such as Host) from its own header set.
        const bodyDelegate = new Request(url.href, requestInit);

        super({
            id: getRequestId(nativeRequest),
            // Resolved now because the IncomingMessage and its socket are not
            // retained once the Web Request above is derived.
            ip: resolveClientIp(nativeRequest, headers, trustProxy),
            method,
            url,
            headers,
            bodyDelegate,
        });
    }
}

// Build a Web Headers instance from the Node headers object. HTTP/2 pseudo-headers
// (':authority', ':method', ...) are skipped because Web Headers rejects their
// names; multi-valued entries (e.g. a repeated header) are appended individually.
function buildHeaders(nativeRequest) {
    const headers = new Headers();

    for (const [ name, value ] of Object.entries(nativeRequest.headers)) {
        if (name.startsWith(':')) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                headers.append(name, item);
            }
        } else if (isString(value)) {
            headers.set(name, value);
        }
    }

    return headers;
}

// The incoming message carries only the request target (path + query), so the
// authority comes from the HTTP/2 :authority pseudo-header or the Host header.
function resolveHost(nativeRequest) {
    return nativeRequest.headers[':authority'] || nativeRequest.headers.host || 'localhost';
}

// Trust X-Forwarded-Proto first (the client-facing scheme when behind a proxy),
// then the socket TLS state, defaulting to http. The first token is used because
// the header may accumulate a list across multiple proxy hops.
function resolveProtocol(nativeRequest) {
    const forwarded = nativeRequest.headers['x-forwarded-proto'];
    const firstForwarded = Array.isArray(forwarded)
        ? forwarded.find(isNonEmptyString)
        : forwarded;

    if (isNonEmptyString(firstForwarded)) {
        return firstForwarded.split(',')[0].trim();
    }
    return nativeRequest.socket?.encrypted ? 'https' : 'http';
}

// Trust the client-settable X-Forwarded-For header only when trustProxy is set,
// because a directly-exposed server would otherwise let a client spoof its own
// IP and defeat IP-based abuse controls. When trusted, the leftmost entry is the
// original client; the header is read from the built Web Headers, which already
// joins repeated header lines into one comma-separated list. Without that trust,
// or when no forwarded value is present, fall back to the transport peer address.
function resolveClientIp(nativeRequest, headers, trustProxy) {
    if (trustProxy) {
        const forwardedFor = (headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
        if (forwardedFor) {
            return forwardedFor;
        }
    }

    const remoteAddress = nativeRequest.socket?.remoteAddress;
    return isNonEmptyString(remoteAddress) ? remoteAddress : null;
}

// GET and HEAD never carry a body (the Request constructor rejects one); for
// other methods a body is present when framed by Content-Length or
// Transfer-Encoding.
function hasRequestBody(method, nativeRequest) {
    if (method === 'GET' || method === 'HEAD') {
        return false;
    }

    if (nativeRequest.headers['transfer-encoding']) {
        return true;
    }

    const contentLength = Number.parseInt(nativeRequest.headers['content-length'], 10);
    return Number.isInteger(contentLength) && contentLength > 0;
}

function getRequestId(nativeRequest) {
    const requestId = nativeRequest.headers['x-request-id'];
    if (Array.isArray(requestId)) {
        const firstRequestId = requestId.find(isNonEmptyString);
        if (firstRequestId) {
            return firstRequestId;
        }
    } else if (requestId) {
        return requestId;
    }

    serverRequestSequence += 1;

    // Node has no Cloudflare cf-ray equivalent; generate a per-process id.
    return `kixx-node-${Date.now().toString(36)}-${serverRequestSequence.toString(36)}`;
}
