/**
 * @fileoverview HTTP server request abstraction for Node.js applications
 * 
 * Provides an immutable, structured interface for accessing HTTP request data,
 * including headers, parameters, cookies, authentication tokens, and body parsing.
 */

import { BadRequestError } from '../errors/mod.js';
import { objectToHeaders } from '../lib/http-utils.js';
import deepFreeze from '../lib/deep-freeze.js';

/**
 * Immutable HTTP request wrapper providing structured access to request data.
 * Wraps Node.js IncomingMessage with convenient accessors for headers, parameters,
 * cookies, authentication, and body parsing capabilities.
 */
export default class HttpServerRequest {
    /**
     * @private
     * @type {import('http').IncomingMessage}
     */
    #nodeRequest = null;

    /**
     * @private
     * @type {Object<string, string>}
     */
    #hostnameParams = Object.freeze({});

    /**
     * @private
     * @type {Object<string, string>}
     */
    #pathnameParams = Object.freeze({});

    /**
     * Creates a new HTTP server request wrapper
     * @param {import('http').IncomingMessage} req - Raw Node.js request object
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
     * Parameters extracted from hostname during routing (e.g., subdomain matching)
     * @returns {Object<string, string>} Frozen hostname parameters object
     */
    get hostnameParams() {
        return this.#hostnameParams;
    }

    /**
     * Parameters extracted from URL pathname during routing (e.g., /users/:id)
     * @returns {Object<string, string>} Frozen pathname parameters object
     */
    get pathnameParams() {
        return this.#pathnameParams;
    }

    /**
     * Query parameters from URL search string
     * @returns {URLSearchParams} Query parameters as URLSearchParams instance
     */
    get queryParams() {
        return this.url.searchParams;
    }

    /**
     * Checks if request method is HEAD
     * @returns {boolean} True if HEAD request
     */
    isHeadRequest() {
        return this.method === 'HEAD';
    }

    /**
     * Determines if client expects JSON response based on multiple indicators
     * @returns {boolean} True if JSON request (content-type, .json extension, or Accept header)
     */
    isJSONRequest() {
        // Priority order: content-type takes precedence for actual data format
        if (this.headers.get('content-type')?.includes('application/json')) {
            return true;
        }
        
        // Fallback: REST API convention - .json extension indicates JSON response desired
        if (this.url.pathname.endsWith('.json')) {
            return true;
        }
        
        // Final fallback: client preference via Accept header
        if (this.headers.get('accept')?.includes('application/json')) {
            return true;
        }
        
        return false;
    }

    /**
     * Checks if request contains form-encoded data
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
        // Deep clone to prevent reference sharing, then freeze for immutability
        // This ensures router params can't be accidentally modified by handlers
        this.#pathnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Sets hostname parameters extracted during hostname matching
     * @private
     * @param {Object<string, string>} params - Hostname parameters to set  
     * @returns {HttpServerRequest} This request instance for chaining
     */
    setHostnameParams(params) {
        // Deep clone to prevent reference sharing, then freeze for immutability
        // This ensures router params can't be accidentally modified by handlers
        this.#hostnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Retrieves specific cookie value by name
     * @param {string} keyname - Cookie name to retrieve
     * @returns {string|null} Cookie value or null if not found
     * @example
     * // Get session cookie
     * const sessionId = request.getCookie('sessionId');
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
     * // Get all cookies
     * const cookies = request.getCookies();
     * // { sessionId: 'abc123', theme: 'dark' }
     */
    getCookies() {
        const cookies = this.headers.get('cookie');
        if (!cookies) {
            return null;
        }
        
        // Parse cookies according to RFC 6265: "name=value; name2=value2"
        const cookieMap = cookies
            .split(';')
            .map((cookie) => cookie.trim())
            .reduce((acc, cookie) => {
                if (!cookie) {
                    return acc;
                }

                const [ key, ...valueParts ] = cookie.split('=');
                
                // Rejoin value parts to handle cookies with = in their values
                // Example: "sessionData=user=john&role=admin" should preserve the = signs
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
     * // Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
     * const token = request.getAuthorizationBearer();
     * // Returns: 'eyJhbGciOiJIUzI1NiIs...'
     */
    getAuthorizationBearer() {
        const authHeader = this.headers.get('authorization');
        if (!authHeader) {
            return null;
        }

        // Split header into scheme and token, limiting to 2 parts
        // to handle tokens that might contain spaces
        const [ scheme, token ] = authHeader.split(/\s+/, 2);

        // Case-insensitive check for "Bearer" scheme per RFC 6750
        if (!/^bearer$/i.test(scheme)) {
            return null;
        }

        return token || null;
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
     * // Parse JSON request body
     * const data = await request.json();
     * // { name: 'John', age: 30 }
     */
    async json() {
        const data = await this.getBufferedStringData('utf8');

        let json;
        try {
            json = JSON.parse(data);
        } catch (cause) {
            // Wrap JSON parse errors in our domain error type for consistent error handling
            throw new BadRequestError(`Error parsing HTTP JSON body: ${ cause.message }`, { cause });
        }

        return json;
    }

    /**
     * Reads and parses request body as form-encoded data
     * @async
     * @returns {Promise<Object<string, string|string[]>>} Form data with arrays for duplicate keys
     * @example
     * // Parse form data: name=John&age=30&tags=red&tags=blue
     * const data = await request.formData();
     * // { name: 'John', age: '30', tags: ['red', 'blue'] }
     */
    async formData() {
        const body = await this.getBufferedStringData('utf8');
        
        // URLSearchParams handles URL decoding and proper form parsing
        const params = new URLSearchParams(body);
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
     * Reads entire request body as string with specified encoding
     * @async
     * @param {BufferEncoding} encoding - Text encoding for string conversion
     * @returns {Promise<string>} Complete request body as string
     * @throws {Error} When stream reading fails
     */
    getBufferedStringData(encoding) {
        return new Promise((resolve, reject) => {
            const req = this.#nodeRequest;
            const chunks = [];

            function onError(err) {
                cleanup();
                reject(err);
            }

            function onData(chunk) {
                // Accumulate chunks in memory - suitable for typical API payloads
                // For large file uploads, consider streaming processing instead
                chunks.push(chunk);
            }

            function onEnd() {
                cleanup();
                // Concatenate all chunks into final buffer, then decode to string
                const data = Buffer.concat(chunks).toString(encoding);
                resolve(data);
            }

            function cleanup() {
                // Essential cleanup to prevent memory leaks in long-lived connections
                req.off('error', onError);
                req.off('data', onData);
                req.off('end', onEnd);
            }

            // Set up stream event handlers
            // Order matters: error handler must be set before data/end handlers
            req.on('error', onError);
            req.on('data', onData);
            req.on('end', onEnd);
        });
    }
}
