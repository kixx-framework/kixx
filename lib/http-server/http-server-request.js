import { isValidDate } from '../assertions/mod.js';
import { BadRequestError } from '../errors/mod.js';
import { objectToHeaders } from '../lib/http-utils.js';

/**
 * HTTP request wrapper providing a clean API for accessing request data.
 * Wraps Node.js IncomingMessage with immutable properties and convenience methods
 * for cookies, authentication, body parsing, and route parameters.
 */
export default class HttpServerRequest {
    /**
     * Underlying Node.js request stream for low-level access.
     * @type {http.IncomingMessage}
     */
    #nodeRequest = null;

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
     * Cached request body to avoid re-reading the stream.
     * @type {Buffer|Promise<Buffer>}
     */
    #bufferedData = null;

    /**
     * Creates a new HTTP server request wrapper with immutable core properties.
     * @param {http.IncomingMessage} req - Raw Node.js request object
     * @param {URL} url - Parsed request URL
     * @param {string} id - Unique request identifier for logging and correlation
     */
    constructor(req, url, id) {
        this.#nodeRequest = req;

        // Immutable properties prevent accidental mutation during request lifecycle
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
             * Web API Headers object providing case-insensitive header access.
             * @name headers
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: objectToHeaders(req.headers),
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
        });
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
     * Determines if request method is HEAD.
     * Useful for skipping body generation while still returning headers.
     * @public
     * @returns {boolean} True if HEAD request
     */
    isHeadRequest() {
        return this.method === 'HEAD';
    }

    /**
     * Determines if client expects a JSON response using multiple detection strategies.
     * Checks in order: Content-Type header, .json URL extension, Accept header.
     * @public
     * @returns {boolean} True if JSON response is expected
     */
    isJSONRequest() {
        // Check content-type first - it indicates the actual data format being sent
        if (this.headers.get('content-type')?.includes('application/json')) {
            return true;
        }

        // REST API convention: .json extension signals client wants JSON response
        if (this.url.pathname.endsWith('.json')) {
            return true;
        }

        // Last resort: check Accept header for client preference
        if (this.headers.get('accept')?.includes('application/json')) {
            return true;
        }

        return false;
    }

    /**
     * Determines if request body contains form-encoded data.
     * @public
     * @returns {boolean} True if content-type is application/x-www-form-urlencoded
     */
    isFormURLEncodedRequest() {
        return this.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    }

    /**
     * Sets pathname parameters extracted during route matching.
     * Called internally by the router after matching URL patterns.
     * @param {Object<string, string>} params - Route parameters to set
     * @returns {HttpServerRequest} This request instance for chaining
     */
    setPathnameParams(params) {
        this.#pathnameParams = params;
        return this;
    }

    /**
     * Sets hostname parameters extracted during hostname matching.
     * Called internally by the router after matching hostname patterns.
     * @param {Object<string, string>} params - Hostname parameters to set
     * @returns {HttpServerRequest} This request instance for chaining
     */
    setHostnameParams(params) {
        this.#hostnameParams = params;
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
        return cookies[ keyname ] || null;
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
                acc[ key.trim() ] = value?.trim() || '';
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

        // Limit split to 2 parts in case token contains spaces
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
            let dt;
            try {
                dt = new Date(ifModifiedSince);
            } catch {
                return null;
            }
            return isValidDate(dt) ? dt : null;
        }
        return null;
    }

    /**
     * Parses the If-None-Match header for conditional GET requests.
     * Used for cache validation - compare against resource's ETag.
     * Returns only the first ETag if multiple are provided.
     * @public
     * @returns {string|null} ETag value (without quotes) or null if header is missing
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

        // Handle improperly quoted ETags gracefully
        return firstEtag;
    }

    /**
     * Provides access to underlying Node.js readable stream for streaming body data.
     * Use this for large uploads instead of buffering the entire body with json() or formData().
     * @public
     * @returns {import('http').IncomingMessage} Raw Node.js request stream
     */
    getReadStream() {
        return this.#nodeRequest;
    }

    /**
     * Reads and parses request body as JSON.
     * Body is buffered and cached, so multiple calls return the same data.
     * @public
     * @async
     * @returns {Promise<*>} Parsed JSON data
     * @throws {BadRequestError} When JSON parsing fails
     */
    async json() {
        const data = await this.getBufferedData();

        let json;
        try {
            json = JSON.parse(data.toString('utf8'));
        } catch (cause) {
            throw new BadRequestError(`Error parsing HTTP JSON body: ${ cause.message }`, { cause });
        }

        return json;
    }

    /**
     * Reads and parses request body as form-encoded data (application/x-www-form-urlencoded).
     * Duplicate keys are collected into arrays. Body is buffered and cached.
     * @public
     * @async
     * @returns {Promise<Object<string, string|string[]>>} Form data with arrays for duplicate keys
     */
    async formData() {
        const data = await this.getBufferedData();

        // URLSearchParams handles URL decoding automatically
        const params = new URLSearchParams(data.toString('utf8'));
        const result = {};

        for (const [ key, value ] of params) {
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                // Collect duplicate keys into arrays (e.g., "tags=red&tags=blue")
                if (Array.isArray(result[key])) {
                    result[key].push(value);
                } else {
                    result[key] = [ result[key], value ];
                }
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * Reads and buffers the complete request body.
     * Result is cached so subsequent calls return the same Buffer.
     * @async
     * @returns {Promise<Buffer>} Complete request body as Buffer
     */
    async getBufferedData() {
        if (this.#bufferedData) {
            return this.#bufferedData;
        }

        const req = this.#nodeRequest;

        // Store promise initially to handle concurrent calls during buffering
        this.#bufferedData = new Promise(function bufferData(resolve, reject) {
            const chunks = [];

            function onError(err) {
                cleanup();
                reject(err);
            }

            function onData(chunk) {
                chunks.push(chunk);
            }

            function onEnd() {
                cleanup();
                resolve(Buffer.concat(chunks));
            }

            function cleanup() {
                // Prevent memory leaks by removing all listeners
                req.off('error', onError);
                req.off('data', onData);
                req.off('end', onEnd);
            }

            req.on('error', onError);
            req.on('data', onData);
            req.on('end', onEnd);
        });

        // Replace promise with resolved Buffer for faster subsequent access
        const buff = await this.#bufferedData;
        this.#bufferedData = buff;
        return buff;
    }
}
