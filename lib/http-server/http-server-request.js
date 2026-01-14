import { isValidDate } from '../assertions/mod.js';
import { BadRequestError } from '../errors/mod.js';
import { objectToHeaders } from '../lib/http-utils.js';

export default class HttpServerRequest {
    /**
     * @private
     * @type {http.IncomingMessage}
     */
    #nodeRequest = null;

    /**
     * @private
     * @type {Object}
     */
    #hostnameParams = Object.freeze({});

    /**
     * @private
     * @type {Object}
     */
    #pathnameParams = Object.freeze({});

    /**
     * @private
     * @type {Buffer|Promise<Buffer>}
     */
    #bufferedData = null;

    /**
     * Creates a new HTTP server request wrapper
     * @param {http.IncomingMessage} req - Raw Node.js request object
     * @param {URL} url - Parsed request URL
     * @param {string} id - Unique request identifier
     */
    constructor(req, url, id) {
        this.#nodeRequest = req;

        // Define properties as non-configurable to prevent accidental mutation
        // This ensures request metadata remains immutable after construction
        Object.defineProperties(this, {
            /**
             * Unique request identifier.
             * @type {string}
             */
            id: {
                enumerable: true,
                value: id,
            },
            /**
             * HTTP method (GET, POST, etc).
             * @type {string}
             */
            method: {
                enumerable: true,
                value: req.method,
            },
            /**
             * Headers as a Headers object (case-insensitive).
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: objectToHeaders(req.headers),
            },
            /**
             * Parsed URL object.
             * @type {URL}
             */
            url: {
                enumerable: true,
                value: url,
            },
        });
    }

    /**
     * Route parameters extracted from hostname during routing
     * @returns {Object} Frozen hostname parameters object
     */
    get hostnameParams() {
        return this.#hostnameParams;
    }

    /**
     * Route parameters extracted from URL pathname during routing
     * @returns {Object} Frozen pathname parameters object
     */
    get pathnameParams() {
        return this.#pathnameParams;
    }

    /**
     * URL query parameters from search string
     * @returns {Object} Query parameters as an object
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
     * Determines if request method is HEAD
     * @returns {boolean} True if HEAD request
     */
    isHeadRequest() {
        return this.method === 'HEAD';
    }

    /**
     * Determines if client expects JSON response
     * @returns {boolean} True if JSON request detected via content-type, .json extension, or Accept header
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
     * Determines if request contains form-encoded data
     * @returns {boolean} True if content-type is application/x-www-form-urlencoded
     */
    isFormURLEncodedRequest() {
        return this.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    }

    /**
     * Sets pathname parameters extracted during route matching
     * @private
     * @param {Object<string, string>} params - Route parameters to set
     * @returns {HttpServerRequest} This request instance for chaining
     */
    setPathnameParams(params) {
        this.#pathnameParams = params;
        return this;
    }

    /**
     * Sets hostname parameters extracted during hostname matching
     * @private
     * @param {Object<string, string>} params - Hostname parameters to set
     * @returns {HttpServerRequest} This request instance for chaining
     */
    setHostnameParams(params) {
        this.#hostnameParams = params;
        return this;
    }

    /**
     * Retrieves specific cookie value by name
     * @param {string} keyname - Cookie name to retrieve
     * @returns {string|null} Cookie value or null if not found
     * @example
     * const sessionId = request.getCookie('sessionId');
     * // Returns 'abc123' or null if cookie doesn't exist
     */
    getCookie(keyname) {
        const cookies = this.getCookies();
        if (!cookies) {
            return null;
        }
        return cookies[ keyname ] || null;
    }

    /**
     * Parses and returns all cookies from Cookie header
     * @returns {Object<string, string>|null} Cookie name-value pairs or null if no cookies
     * @example
     * const cookies = request.getCookies();
     * // Returns { sessionId: 'abc123', theme: 'dark' } or null
     */
    getCookies() {
        const cookies = this.headers.get('cookie');
        if (!cookies) {
            return null;
        }

        // Parse cookies per RFC 6265: "name=value; name2=value2"
        const cookieMap = cookies
            .split(';')
            .map((cookie) => cookie.trim())
            .reduce((acc, cookie) => {
                if (!cookie) {
                    return acc;
                }

                const [ key, ...valueParts ] = cookie.split('=');

                // Rejoin value parts to preserve = signs in cookie values
                // Example: "sessionData=user=john&role=admin" contains multiple = signs
                const value = valueParts.join('=');
                acc[ key.trim() ] = value?.trim() || '';
                return acc;
            }, {});

        return cookieMap;
    }

    /**
     * Extracts Bearer token from Authorization header
     * @returns {string|null} Bearer token without "Bearer " prefix, or null if not found
     * @example
     * // For Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
     * const token = request.getAuthorizationBearer();
     * // Returns 'eyJhbGciOiJIUzI1NiIs...' or null
     */
    getAuthorizationBearer() {
        const authHeader = this.headers.get('authorization');
        if (!authHeader) {
            return null;
        }

        // Split into scheme and token, limiting to 2 parts to handle spaces in tokens
        const [ scheme, token ] = authHeader.split(/\s+/, 2);

        // Case-insensitive check for "Bearer" scheme per RFC 6750
        if (!/^bearer$/i.test(scheme)) {
            return null;
        }

        return token || null;
    }

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

    get ifNoneMatch() {
        const ifNoneMatch = this.headers.get('if-none-match');
        if (!ifNoneMatch) {
            return null;
        }

        // If-None-Match can contain multiple ETags separated by commas
        // Extract the first ETag and remove quotes
        const firstEtag = ifNoneMatch.split(',')[0].trim();

        // Remove leading and trailing double quotes
        // ETags are wrapped in quotes per RFC 7232: "abc123"
        if (firstEtag.startsWith('"') && firstEtag.endsWith('"')) {
            return firstEtag.slice(1, -1);
        }

        // Return as-is if not properly quoted (edge case)
        return firstEtag;
    }

    /**
     * Provides access to underlying Node.js readable stream
     * @returns {import('http').IncomingMessage} Raw Node.js request stream
     */
    getReadStream() {
        return this.#nodeRequest;
    }

    /**
     * Reads and parses request body as JSON
     * @async
     * @returns {Promise<*>} Parsed JSON data
     * @throws {BadRequestError} When JSON parsing fails
     * @example
     * const data = await request.json();
     * // Returns parsed object like { name: 'John', age: 30 }
     */
    async json() {
        const data = await this.getBufferedData();

        let json;
        try {
            json = JSON.parse(data.toString('utf8'));
        } catch (cause) {
            // Wrap JSON parse errors in domain error for consistent error handling
            throw new BadRequestError(`Error parsing HTTP JSON body: ${ cause.message }`, { cause });
        }

        return json;
    }

    /**
     * Reads and parses request body as form-encoded data
     * @async
     * @returns {Promise<Object<string, string|string[]>>} Form data with arrays for duplicate keys
     * @example
     * // For form data: name=John&age=30&tags=red&tags=blue
     * const data = await request.formData();
     * // Returns { name: 'John', age: '30', tags: ['red', 'blue'] }
     */
    async formData() {
        const data = await this.getBufferedData();

        // URLSearchParams handles URL decoding and proper form parsing
        const params = new URLSearchParams(data.toString('utf8'));
        const result = {};

        // Transform URLSearchParams entries into a plain object
        for (const [ key, value ] of params) {
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                // Handle multiple values for same key: convert to array
                // Example: "tags=red&tags=blue" becomes { tags: ["red", "blue"] }
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
     * Reads and buffers the complete request body
     * @async
     * @private
     * @returns {Promise<Buffer>} Complete request body as Buffer
     * @throws {Error} When request stream encounters an error
     */
    async getBufferedData() {
        if (this.#bufferedData) {
            return this.#bufferedData;
        }

        const req = this.#nodeRequest;

        this.#bufferedData = new Promise(function bufferData(resolve, reject) {
            const chunks = [];

            function onError(err) {
                cleanup();
                reject(err);
            }

            function onData(chunk) {
                // Buffer chunks in memory for typical API payloads (not large files)
                chunks.push(chunk);
            }

            function onEnd() {
                cleanup();
                // Combine all chunks into final buffer
                const data = Buffer.concat(chunks);
                resolve(data);
            }

            function cleanup() {
                // Remove event listeners to prevent memory leaks
                req.off('error', onError);
                req.off('data', onData);
                req.off('end', onEnd);
            }

            // Set up event handlers - error handler first to catch early errors
            req.on('error', onError);
            req.on('data', onData);
            req.on('end', onEnd);
        });

        const buff = await this.#bufferedData;
        this.#bufferedData = buff;
        return buff;
    }
}
