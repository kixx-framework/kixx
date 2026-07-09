import { Readable } from 'node:stream';
import {
    isNonEmptyString,
    isString,
    isValidDate,
} from '../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    UnsupportedMediaTypeError,
} from '../../../kixx/errors/mod.js';
import deepFreeze from '../../../kixx/utils/deep-freeze.js';

let serverRequestSequence = 0;

const FORM_DATA_CONTENT_TYPES = Object.freeze([
    'application/x-www-form-urlencoded',
    'multipart/form-data',
]);

/**
 * Wraps a Node.js `http.IncomingMessage` with the Kixx HTTP router request contract.
 *
 * Node's `IncomingMessage` provides none of the Web primitives the router and
 * middleware expect, so the constructor derives them: a Web `Headers` instance,
 * a fully resolved `URL` (the incoming message only carries the path), and an
 * internal Web `Request` that bridges the Node body stream so `body`, `json()`,
 * and `formData()` delegate to the platform's spec-compliant parsing.
 *
 * @implements {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface}
 */
export default class ServerRequest {

    #request = null;

    #hostnameParams = Object.freeze({});
    #pathnameParams = Object.freeze({});

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
        this.#request = new Request(url.href, requestInit);

        Object.defineProperties(this, {
            /**
             * X-Request-Id when supplied by an upstream proxy, otherwise a per-process fallback.
             * @name id
             * @type {string}
             */
            id: {
                enumerable: true,
                value: getRequestId(nativeRequest),
            },
            /**
             * Originating client IP address, or null when it cannot be determined.
             * @name ip
             * @type {string|null}
             */
            ip: {
                enumerable: true,
                // Resolved now because the IncomingMessage and its socket are not
                // retained once the Web Request below is derived.
                value: resolveClientIp(nativeRequest, headers, trustProxy),
            },
            /**
             * HTTP method normalized for router comparisons.
             * @name method
             * @type {string}
             */
            method: {
                enumerable: true,
                value: method,
            },
            /**
             * Fully resolved request URL, reconstructed from the request line and Host.
             * @name url
             * @type {URL}
             */
            url: {
                enumerable: true,
                value: url,
            },
            /**
             * Request headers exposed through the Web API `Headers` interface.
             * @name headers
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: headers,
            },
        });
    }

    /**
     * @type {ReadableStream|null}
     */
    get body() {
        return this.#request.body;
    }

    /**
     * @type {Object<string, string|string[]>}
     */
    get hostnameParams() {
        return this.#hostnameParams;
    }

    /**
     * @type {Object<string, string|string[]>}
     */
    get pathnameParams() {
        return this.#pathnameParams;
    }

    /**
     * @type {Object<string, string|string[]>}
     */
    get queryParams() {
        const params = {};
        for (const key of this.url.searchParams.keys()) {
            const vals = this.url.searchParams.getAll(key);
            if (vals.length > 1) {
                params[key] = vals;
            } else {
                params[key] = vals[0];
            }
        }
        return params;
    }

    /**
     * @returns {boolean} `true` when this request uses the HEAD method
     */
    isHeadRequest() {
        return this.method === 'HEAD';
    }

    /**
     * @returns {boolean} `true` when the client explicitly requests JSON
     */
    isJSONRequest() {
        // REST API convention: .json extension explicitly requests a JSON response
        if (this.url.pathname.endsWith('.json')) {
            return true;
        }

        if (this.headers.get('accept')?.includes('application/json')) {
            return true;
        }

        return false;
    }

    /**
     * @returns {boolean} `true` when the request body is URL-encoded form data
     */
    isFormURLEncodedRequest() {
        return this.getContentMediaType() === 'application/x-www-form-urlencoded';
    }

    /**
     * Returns the request Content-Type media type without parameters.
     * @returns {string} Normalized media type, or an empty string when absent
     */
    getContentMediaType() {
        const contentType = this.headers.get('content-type') ?? '';
        return contentType.split(';')[0].trim().toLowerCase();
    }

    /**
     * Sets pathname pattern params extracted by the router.
     * @param {Object<string, string|string[]>} params - Matched pathname params
     * @returns {ServerRequest} This request for chaining
     */
    setPathnameParams(params) {
        this.#pathnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Sets hostname pattern params extracted by the router.
     * @param {Object<string, string|string[]>} params - Matched hostname params
     * @returns {ServerRequest} This request for chaining
     */
    setHostnameParams(params) {
        this.#hostnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Returns one cookie value by name.
     * @param {string} keyname - Cookie name
     * @returns {string|null} Cookie value, or `null` when absent
     */
    getCookie(keyname) {
        const cookies = this.getCookies();
        if (!cookies) {
            return null;
        }
        return cookies[ keyname ] ?? null;
    }

    /**
     * Parses the Cookie header into a name/value map.
     * @returns {Object<string, string>|null} Cookie map, or `null` when the header is absent
     */
    getCookies() {
        const cookies = this.headers.get('cookie');
        if (!cookies) {
            return null;
        }

        const cookieMap = cookies
            .split(';')
            .map((cookie) => cookie.trim())
            .reduce((acc, cookie) => {
                if (!cookie) {
                    return acc;
                }

                const [ key, ...valueParts ] = cookie.split('=');

                // Rejoin to preserve = signs in values (e.g., "data=user=john&role=admin")
                const value = valueParts.join('=');
                acc[ key.trim() ] = value.trim() || '';
                return acc;
            }, {});

        return cookieMap;
    }

    /**
     * Extracts an RFC 6750 Bearer token from the Authorization header.
     * @returns {string|null} Bearer token without its scheme, or `null` when absent or malformed
     */
    getAuthorizationBearer() {
        const authHeader = this.headers.get('authorization');
        if (!authHeader) {
            return null;
        }

        // Bearer credentials are a single token. Reject malformed values with
        // embedded whitespace instead of silently truncating them.
        const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
        return match ? match[1] : null;
    }

    /**
     * @type {Date|null}
     */
    get ifModifiedSince() {
        const ifModifiedSince = this.headers.get('if-modified-since');
        if (ifModifiedSince) {
            const dt = new Date(ifModifiedSince);
            return isValidDate(dt) ? dt : null;
        }
        return null;
    }

    /**
     * @type {string|null}
     */
    get ifNoneMatch() {
        const ifNoneMatch = this.headers.get('if-none-match');
        if (!ifNoneMatch) {
            return null;
        }

        const firstEtag = getFirstHeaderListValue(ifNoneMatch);

        if (firstEtag.startsWith('"') && firstEtag.endsWith('"')) {
            return firstEtag.slice(1, -1);
        }

        return firstEtag;
    }

    /**
     * Reads and parses the request body as JSON.
     * @returns {Promise<*>} Parsed JSON body
     * @throws {BadRequestError} When the body cannot be parsed as JSON
     */
    async json() {
        try {
            const json = await this.#request.json();
            return json;
        } catch (cause) {
            throw new BadRequestError('Invalid JSON in request body', { cause }, this.json);
        }
    }

    /**
     * Reads the request body as a UTF-8 string.
     * @returns {Promise<string>} The request body decoded as text
     * @throws {BadRequestError} When the body cannot be read
     */
    async text() {
        try {
            return await this.#request.text();
        } catch (cause) {
            throw new BadRequestError('Request body could not be read as text', { cause }, this.text);
        }
    }

    /**
     * Reads and parses the request body as form data.
     * @returns {Promise<FormData>} Parsed form data
     * @throws {UnsupportedMediaTypeError} When the content type is missing or unsupported.
     * @throws {BadRequestError} When the body cannot be parsed as form data.
     */
    async formData() {
        const contentType = this.getContentMediaType();

        if (!FORM_DATA_CONTENT_TYPES.includes(contentType)) {
            throw new UnsupportedMediaTypeError(
                'Content-Type must be application/x-www-form-urlencoded or multipart/form-data',
                { accept: FORM_DATA_CONTENT_TYPES },
                this.formData,
            );
        }

        try {
            return await this.#request.formData();
        } catch (cause) {
            throw new BadRequestError('Request body could not be parsed as form data', { cause }, this.formData);
        }
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

function getFirstHeaderListValue(headerValue) {
    let isQuoted = false;

    for (let index = 0; index < headerValue.length; index += 1) {
        const char = headerValue.charAt(index);

        // If-None-Match is a comma-delimited list, but quoted ETag values may
        // contain commas inside the opaque tag and must stay intact.
        if (char === '"') {
            isQuoted = !isQuoted;
        } else if (char === ',' && !isQuoted) {
            return headerValue.slice(0, index).trim();
        }
    }

    return headerValue.trim();
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
