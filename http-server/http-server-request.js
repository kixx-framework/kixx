import { BadRequestError } from '../errors/mod.js';
import { objectToHeaders } from '../lib/http-utils.js';
import deepFreeze from '../lib/deep-freeze.js';


/**
 * BaseServerRequest provides a structured, immutable, and convenient interface
 * for accessing and parsing HTTP request data in a server environment.
 *
 * This class wraps the raw Node.js IncomingMessage and exposes:
 *   - Immutable request metadata (id, method, headers, url)
 *   - Parameter accessors for hostname and pathname (set by router)
 *   - Query parameter access (URLSearchParams)
 *   - Cookie parsing and retrieval
 *   - Authorization header parsing (Bearer tokens)
 *   - Helpers for detecting request type (JSON, form)
 *   - Methods for reading and parsing the request body (JSON, form, raw)
 *
 * All mutation of parameters is internal and results in frozen objects.
 */
export default class HttpServerRequest {
    /**
     * @private
     * @type {import('http').IncomingMessage}
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
     * Constructs a new BaseServerRequest.
     * @param {import('http').IncomingMessage} req - The raw Node.js request.
     * @param {URL} url - The parsed request URL.
     * @param {string} id - A unique request identifier.
     */
    constructor(req, url, id) {
        this.#nodeRequest = req;

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
     * Returns the parameters extracted from the hostname portion of the request.
     * These are typically set by the router when matching virtual hosts.
     * The returned object is frozen and should not be mutated.
     * @returns {Object} The hostname parameters.
     */
    get hostnameParams() {
        return this.#hostnameParams;
    }

    /**
     * Returns the parameters extracted from the pathname portion of the request.
     * These are typically set by the router when matching routes.
     * The returned object is frozen and should not be mutated.
     * @returns {Object} The pathname parameters.
     */
    get pathnameParams() {
        return this.#pathnameParams;
    }

    /**
     * Returns the query parameters extracted from the request URL.
     * The returned object is a URLSearchParams object (like a Map).
     * It does not parse the values and return primitive types. It only extracts strings.
     * @returns {Map} The query parameters.
     */
    get queryParams() {
        return this.url.searchParams;
    }

    /**
     * Returns true if the request method is HEAD.
     * @returns {boolean} True if the request method is HEAD.
     */
    isHeadRequest() {
        return this.method === 'HEAD';
    }

    /**
     * Returns true if the request is a JSON request.
     * Checks the content-type header, then the pathname, and finally the accept header.
     * @returns {boolean} True if the request is a JSON request.
     */
    isJSONRequest() {
        if (this.headers.get('content-type')?.includes('application/json')) {
            return true;
        }
        if (this.url.pathname.endsWith('.json')) {
            return true;
        }
        if (this.headers.get('accept')?.includes('application/json')) {
            return true;
        }
        return false;
    }

    /**
     * Returns true if the request is a form URL-encoded request.
     * Checks the content-type header for 'application/x-www-form-urlencoded'.
     * @returns {boolean} True if the request is form URL-encoded.
     */
    isFormURLEncodedRequest() {
        return this.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    }

    /**
     * Sets the pathname parameters for the request.
     * The parameters are frozen and should not be mutated.
     * @private
     * @param {Object} params - The pathname parameters.
     * @returns {BaseServerRequest} The request instance.
     */
    setPathnameParams(params) {
        this.#pathnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Sets the hostname parameters for the request.
     * The parameters are frozen and should not be mutated.
     * @private
     * @param {Object} params - The hostname parameters.
     * @returns {BaseServerRequest} The request instance.
     */
    setHostnameParams(params) {
        this.#hostnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Returns the value of a cookie with the given keyname.
     * It does not parse the values and return primitive types. It only extracts strings.
     * @param {string} keyname - The name of the cookie.
     * @returns {string|null} The value of the cookie, or null if not found.
     */
    getCookie(keyname) {
        const cookies = this.getCookies();
        if (!cookies) {
            return null;
        }
        return cookies[ keyname ] || null;
    }

    /**
     * Returns all cookies from the request.
     * It does not parse the values and return primitive types. It only extracts strings.
     * @returns {Object|null} The cookies, or null if no cookies are found.
     */
    getCookies() {
        const cookies = this.headers.get('cookie');
        if (!cookies) {
            return null;
        }
        // Parse cookies: "a=1; b=2" => { a: "1", b: "2" }
        const cookieMap = cookies
            .split(';')
            .map((cookie) => cookie.trim())
            .reduce((acc, cookie) => {
                // Skip empty cookies
                if (!cookie) {
                    return acc;
                }

                const [ key, ...valueParts ] = cookie.split('=');
                // Handle cookies with = in the value by rejoining
                const value = valueParts.join('=');
                acc[ key.trim() ] = value?.trim() || '';
                return acc;
            }, {});

        return cookieMap;
    }

    /**
     * Returns the Bearer token from the Authorization header, or null.
     * Strips the "Bearer " prefix from the header value.
     * @returns {string|null}
     */
    getAuthorizationBearer() {
        const authHeader = this.headers.get('authorization');
        if (!authHeader) {
            return null;
        }

        const [ scheme, token ] = authHeader.split(/\s+/, 2);

        if (!/^bearer$/i.test(scheme)) {
            return null;
        }

        return token || null;
    }

    /**
     * Returns the raw Node.js IncomingMessage (readable stream).
     * @returns {import('http').IncomingMessage}
     */
    getReadStream() {
        return this.#nodeRequest;
    }

    /**
     * Reads and parses the request body as JSON.
     * Throws BadRequestError if parsing fails.
     * @returns {Promise<Object>}
     */
    async json() {
        const data = await this.getBufferedStringData('utf8');

        let json;
        try {
            json = JSON.parse(data);
        } catch (cause) {
            throw new BadRequestError(`Error parsing HTTP JSON body: ${ cause.message }`, { cause });
        }

        return json;
    }

    /**
     * Reads and parses the request body as form data (application/x-www-form-urlencoded).
     * Returns an object with key/value pairs. Multiple values for a key become arrays.
     * @returns {Promise<Object>}
     */
    async formData() {
        const body = await this.getBufferedStringData('utf8');
        // Use URLSearchParams for robust parsing
        const params = new URLSearchParams(body);
        const result = {};
        for (const [ key, value ] of params) {
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                // Convert to array if multiple values for the same key
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
     * Reads and buffers the entire request body as a string with the specified encoding.
     * @param {BufferEncoding} encoding - The encoding to use for the resulting string.
     * @returns {Promise<string>} The buffered request body as a string.
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
                chunks.push(chunk);
            }

            function onEnd() {
                cleanup();
                const data = Buffer.concat(chunks).toString(encoding);
                resolve(data);
            }

            // Cleanup function to remove all listeners
            function cleanup() {
                req.off('error', onError);
                req.off('data', onData);
                req.off('end', onEnd);
            }

            req.on('error', onError);
            req.on('data', onData);
            req.on('end', onEnd);
        });
    }
}
