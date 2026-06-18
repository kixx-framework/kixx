import {
    isObjectNotNull,
    isValidDate,
} from '../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    UnsupportedMediaTypeError,
} from '../../../kixx/errors/mod.js';

let serverRequestSequence = 0;

const FORM_DATA_CONTENT_TYPES = Object.freeze([
    'application/x-www-form-urlencoded',
    'multipart/form-data',
]);

/**
 * Wraps a Cloudflare Workers `Request` with the Kixx HTTP router request contract.
 *
 * @implements {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface}
 */
export default class ServerRequest {

    #nativeRequest = null;
    #hostnameParams = Object.freeze({});
    #pathnameParams = Object.freeze({});

    /**
     * @param {Request} nativeRequest - Cloudflare Workers request to adapt
     */
    constructor(nativeRequest) {

        this.#nativeRequest = nativeRequest;

        Object.defineProperties(this, {
            /**
             * Cloudflare Ray ID when available, otherwise a per-process fallback for local worker runtimes.
             * @name id
             * @type {string}
             */
            id: {
                enumerable: true,
                value: getRequestId(nativeRequest),
            },
            /**
             * HTTP method normalized for router comparisons.
             * @name method
             * @type {string}
             */
            method: {
                enumerable: true,
                value: nativeRequest.method.toUpperCase(),
            },
            /**
             * Fully parsed request URL.
             * @name url
             * @type {URL}
             */
            url: {
                enumerable: true,
                value: new URL(nativeRequest.url),
            },
            /**
             * Request headers exposed through the Web API `Headers` interface.
             * @name headers
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: nativeRequest.headers,
            },
        });
    }

    /**
     * @type {ReadableStream|null}
     */
    get body() {
        return this.#nativeRequest.body;
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
        return getBaseContentType(this.headers) === 'application/x-www-form-urlencoded';
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
            const json = await this.#nativeRequest.json();
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
            return await this.#nativeRequest.text();
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
        const contentType = getBaseContentType(this.headers);

        if (!FORM_DATA_CONTENT_TYPES.includes(contentType)) {
            throw new UnsupportedMediaTypeError(
                'Content-Type must be application/x-www-form-urlencoded or multipart/form-data',
                { accept: FORM_DATA_CONTENT_TYPES },
                this.formData,
            );
        }

        try {
            return await this.#nativeRequest.formData();
        } catch (cause) {
            throw new BadRequestError('Request body could not be parsed as form data', { cause }, this.formData);
        }
    }
}

// Freeze recursively so that wildcard params — which path-to-regexp returns as
// arrays — cannot be mutated by one middleware and observed by another. A
// shallow Object.freeze would leave those nested arrays writable.
function deepFreeze(value) {
    if (isObjectNotNull(value)) {
        for (const key of Object.keys(value)) {
            deepFreeze(value[ key ]);
        }
        Object.freeze(value);
    }
    return value;
}

function getBaseContentType(headers) {
    const contentType = headers.get('content-type') ?? '';
    return contentType.split(';')[0].trim().toLowerCase();
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
    const cfRay = nativeRequest.headers.get('cf-ray');
    if (cfRay) {
        return cfRay;
    }

    serverRequestSequence += 1;

    // Local worker test environments do not always provide Cloudflare's cf-ray header.
    return `kixx-cf-${Date.now().toString(36)}-${serverRequestSequence.toString(36)}`;
}
