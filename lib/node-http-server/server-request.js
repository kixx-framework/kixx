import { Readable } from 'node:stream';
import { BadRequestError } from '../errors.js';
import { isValidDate } from '../assertions.js';


/**
 * Node.js adapter for the ServerRequest port.
 *
 * Wraps a Node.js `http.IncomingMessage` to satisfy the ServerRequest port contract,
 * converting it to a Web API-compatible interface for use in the Kixx router pipeline.
 *
 * @see module:ports/http-server-request
 */
export default class ServerRequest {

    /**
     * @type {http.IncomingMessage}
     */
    #incomingMessage = null;

    /**
     * @type {ReadableStream|null}
     */
    #body = null;

    /**
     * Route parameters extracted from hostname pattern matching.
     * @type {Object<string, string>}
     */
    #hostnameParams = Object.freeze({});

    /**
     * Route parameters extracted from URL pathname pattern matching.
     * @type {Object<string, string>}
     */
    #pathnameParams = Object.freeze({});

    /**
     * @param {http.IncomingMessage} req - Raw Node.js request object
     * @param {URL} url - Parsed request URL
     * @param {string} id - Unique request identifier for logging and correlation
     */
    constructor(req, url, id) {

        this.#incomingMessage = req;

        Object.defineProperties(this, {
            /**
             * Unique identifier for correlating logs, errors, and responses.
             * @name id
             * @type {string}
             */
            id: {
                enumerable: true,
                value: id,
            },
            /**
             * HTTP method in uppercase (GET, POST, PUT, DELETE, etc).
             * @name method
             * @type {string}
             */
            method: {
                enumerable: true,
                value: req.method,
            },
            /**
             * Parsed URL with hostname, pathname, searchParams, etc.
             * @name url
             * @type {URL}
             */
            url: {
                enumerable: true,
                value: url,
            },
            /**
             * Web API Headers object providing case-insensitive header access.
             * @name headers
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: objectToHeaders(req.headers),
            },
        });
    }

    /**
     * Web API ReadableStream providing access to the HTTP request body.
     * @public
     * @returns {ReadableStream}
     */
    get body() {
        // Cached so repeated accesses return the same stream — the underlying
        // IncomingMessage can only be consumed once.
        if (this.#body === null) {
            this.#body = Readable.toWeb(this.#incomingMessage);
        }
        return this.#body;
    }

    /**
     * Route parameters extracted from hostname pattern matching during routing.
     * For pattern `{tenant}.example.com`, request to `acme.example.com` yields `{ tenant: 'acme' }`.
     * @public
     * @returns {Object<string, string>} Frozen hostname parameters object
     */
    get hostnameParams() {
        return this.#hostnameParams;
    }

    /**
     * Route parameters extracted from URL pathname pattern matching during routing.
     * For pattern `/users/{id}`, request to `/users/123` yields `{ id: '123' }`.
     * @public
     * @returns {Object<string, string>} Frozen pathname parameters object
     */
    get pathnameParams() {
        return this.#pathnameParams;
    }

    /**
     * URL query parameters parsed from the search string.
     * Duplicate keys are returned as arrays.
     * @public
     * @returns {Object<string, string|string[]>} Query parameters object
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
     * Returns true when the HTTP method is HEAD.
     * Useful for skipping body generation while still returning the correct response headers.
     * @public
     * @returns {boolean}
     */
    isHeadRequest() {
        return this.method === 'HEAD';
    }

    /**
     * Determines if the client expects a JSON response, by checking the URL extension
     * and Accept header.
     * @public
     * @returns {boolean} True if the URL ends with '.json' or the Accept header includes 'application/json'
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
     * Determines if request body contains form-encoded data.
     * @public
     * @returns {boolean} True when the Content-Type header includes 'application/x-www-form-urlencoded'
     */
    isFormURLEncodedRequest() {
        const contentType = this.headers.get('content-type');
        return contentType !== null && contentType.includes('application/x-www-form-urlencoded');
    }

    /**
     * Sets pathname parameters extracted during route matching.
     * Called internally by the router after matching URL patterns.
     * @param {Object<string, string>} params - Route parameters to set
     * @returns {ServerRequest} This request instance for chaining
     */
    setPathnameParams(params) {
        this.#pathnameParams = Object.freeze(structuredClone(params));
        return this;
    }

    /**
     * Sets hostname parameters extracted during hostname matching.
     * Called internally by the router after matching hostname patterns.
     * @param {Object<string, string>} params - Hostname parameters to set
     * @returns {ServerRequest} This request instance for chaining
     */
    setHostnameParams(params) {
        this.#hostnameParams = Object.freeze(structuredClone(params));
        return this;
    }

    /**
     * Retrieves a specific cookie value by name.
     * @public
     * @param {string} keyname - Cookie name to retrieve
     * @returns {string|null} Cookie value or null if not found
     */
    getCookie(keyname) {
        const cookies = this.getCookies();
        if (!cookies) {
            return null;
        }
        return cookies[ keyname ] ?? null;
    }

    /**
     * Parses and returns all cookies from the Cookie header.
     * @public
     * @returns {Object<string, string>|null} Cookie name-value pairs or null if no cookies
     */
    getCookies() {
        const cookies = this.headers.get('cookie');
        if (!cookies) {
            return null;
        }

        // RFC 6265 format: "name=value; name2=value2"
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
     * Extracts Bearer token from Authorization header per RFC 6750.
     * @public
     * @returns {string|null} Bearer token without "Bearer " prefix, or null if not present
     */
    getAuthorizationBearer() {
        const authHeader = this.headers.get('authorization');
        if (!authHeader) {
            return null;
        }

        // RFC 6750 tokens never contain whitespace; the limit prevents pathological input
        // from allocating a large array for a malformed Authorization header
        const [ scheme, token ] = authHeader.split(/\s+/, 2);

        // RFC 6750 allows case-insensitive scheme matching
        if (!/^bearer$/i.test(scheme)) {
            return null;
        }

        return token || null;
    }

    /**
     * Parses the If-Modified-Since header for conditional GET requests.
     * Used for cache validation - compare against resource's Last-Modified date.
     * @public
     * @returns {Date|null} Parsed date or null if header is missing/invalid
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
     * Parses the If-None-Match header for conditional GET requests.
     * Used for cache validation - compare against resource's ETag.
     * Returns only the first ETag if multiple are provided.
     * @public
     * @returns {string|null} ETag value or null if header is missing. Quotes are stripped
     *   from strong ETags; weak ETags (W/"...") are returned as-is.
     */
    get ifNoneMatch() {
        const ifNoneMatch = this.headers.get('if-none-match');
        if (!ifNoneMatch) {
            return null;
        }

        // If-None-Match can contain multiple ETags; we use the first one
        const firstEtag = ifNoneMatch.split(',')[0].trim();

        // RFC 7232: ETags are quoted strings like "abc123"
        if (firstEtag.startsWith('"') && firstEtag.endsWith('"')) {
            return firstEtag.slice(1, -1);
        }

        // Return the raw value rather than rejecting — it can still be used for comparison
        return firstEtag;
    }

    /**
     * Reads and parses the request body as JSON.
     * @public
     * @async
     * @returns {Promise<*>} Parsed JSON value
     * @throws {BadRequestError} When JSON parsing fails — unlike the Web API Request#json()
     *   which rejects with a SyntaxError, parse failures are wrapped in a BadRequestError
     *   so they surface as 400 responses in the error handling pipeline.
     */
    async json() {
        const text = await new Response(this.body).text();

        try {
            return JSON.parse(text);
        } catch (cause) {
            throw new BadRequestError(`Error parsing HTTP JSON body: ${ cause.message }`, { cause });
        }
    }

    /**
     * Reads and parses the request body as form data.
     * Supports application/x-www-form-urlencoded and multipart/form-data content types,
     * selected automatically based on the Content-Type request header.
     * @public
     * @async
     * @returns {Promise<FormData>} Parsed form data
     * @throws {TypeError} When the Content-Type header is missing or not a supported form data type
     */
    async formData() {
        // Forward this.headers so Response picks up the Content-Type — including the
        // boundary parameter required to correctly parse multipart/form-data bodies.
        const response = new Response(this.body, { headers: this.headers });
        return response.formData();
    }
}

/**
 * Converts a Node.js IncomingMessage headers object to a Web API Headers instance.
 * @param {Object} headersObj - The raw headers object from a Node.js IncomingMessage
 * @returns {Headers} Web API Headers instance with case-insensitive header access
 */
function objectToHeaders(headersObj) {
    const headers = new Headers();

    for (const [ name, value ] of Object.entries(headersObj)) {
        if (Array.isArray(value)) {
            // Node.js represents set-cookie as an array because multiple Set-Cookie
            // headers are valid in a single response. Each must be appended individually
            // so the Headers object preserves all cookies rather than overwriting them.
            for (const item of value) {
                headers.append(name, item);
            }
        } else {
            headers.set(name, value);
        }
    }

    return headers;
}
