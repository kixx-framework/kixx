import deepMerge from '../lib/deep-merge.js';
import deepFreeze from '../lib/deep-freeze.js';

import {
    assert,
    assertNonEmptyString,
    isNonEmptyString,
    isNumberNotNaN,
    isBoolean
} from '../assertions/mod.js';


/**
 * HTTP response builder providing fluent API for constructing server responses.
 * Supports status codes, headers, cookies, and various response body types including
 * JSON, HTML, redirects, streams, and custom properties management.
 */
export default class HttpServerResponse {
    /**
     * @type {Object}
     * @private
     * @description
     * Custom properties for this response, deeply frozen for immutability.
     */
    #props = Object.freeze({});

    /**
     * Creates a new HTTP response instance with default 200 status and empty headers.
     * @param {string|number} id - Unique identifier for this response instance
     */
    constructor(id) {
        /**
         * @type {number}
         * @description HTTP status code for the response.
         */
        this.status = 200;

        /**
         * @type {*}
         * @description The response body. Can be string, Buffer, stream, etc.
         */
        this.body = null;

        Object.defineProperties(this, {
            /**
             * Unique identifier for correlating this response with its originating request.
             * @name id
             * @type {string|number}
             */
            id: {
                enumerable: true,
                value: id,
            },
            /**
             * Web API Headers object for managing response headers.
             * @name headers
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: new Headers(),
            },
        });
    }

    /**
     * Custom properties for passing data between middleware handlers.
     * The returned object is deeply frozen to prevent accidental mutation.
     * @public
     * @returns {Object} The immutable response properties object
     */
    get props() {
        return this.#props;
    }

    /**
     * Merges new properties into the response's custom properties object.
     * Performs a deep merge and freezes the result for immutability.
     * @public
     * @param {Object} params - Properties to merge into existing custom properties
     * @returns {HttpServerResponse} This response instance for method chaining
     */
    updateProps(params) {
        this.#props = deepMerge(structuredClone(this.#props), params);
        deepFreeze(this.#props);
        return this;
    }

    /**
     * Sets a header on the response, replacing any existing value for that header name.
     * @public
     * @param {string} key - The header name
     * @param {string} val - The header value
     * @returns {HttpServerResponse} This response instance for method chaining
     */
    setHeader(key, val) {
        this.headers.set(key, val);
        return this;
    }

    /**
     * Appends a value to a header, allowing multiple values for the same header name.
     * Useful for headers like Set-Cookie that can appear multiple times.
     * @public
     * @param {string} key - The header name
     * @param {string} val - The header value to append
     * @returns {HttpServerResponse} This response instance for method chaining
     */
    appendHeader(key, val) {
        this.headers.append(key, val);
        return this;
    }

    /**
     * Sets a cookie on the response with secure defaults (Secure, HttpOnly, SameSite=Lax).
     * Pass explicit false to disable individual security attributes when needed.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
     *
     * @public
     * @param {string} key - The cookie name
     * @param {string} val - The cookie value
     * @param {Object} [options]
     * @param {number} [options.maxAge] - Seconds until expiration (omit for session cookie)
     * @param {boolean} [options.secure=true] - HTTPS only; set false for local development
     * @param {boolean} [options.httpOnly=true] - Block JavaScript access; set false for client-readable cookies
     * @param {'Strict'|'Lax'|'None'} [options.sameSite='Lax'] - Cross-site request policy
     * @param {string} [options.path] - URL path scope for the cookie
     * @returns {HttpServerResponse} This response instance for method chaining
     */
    setCookie(key, val, options) {
        const {
            maxAge,
            secure,
            httpOnly,
            sameSite,
            path,
        } = options || {};

        let cookie = `${ key }=${ val }`;

        if (maxAge) {
            cookie = `${ cookie }; Max-Age=${ maxAge }`;
        }

        if (path) {
            cookie = `${ cookie }; Path=${ path }`;
        }

        // Default to secure cookies unless explicitly set to false
        // This follows security best practices for production environments
        if (secure || !isBoolean(secure)) {
            cookie = `${ cookie }; Secure`;
        }

        // Default to HttpOnly unless explicitly set to false
        // Prevents XSS attacks by blocking JavaScript access to the cookie
        if (httpOnly || !isBoolean(httpOnly)) {
            cookie = `${ cookie }; HttpOnly`;
        }

        if (sameSite) {
            cookie = `${ cookie }; SameSite=${ sameSite }`;
        } else {
            // Default to 'Lax' for CSRF protection while maintaining usability
            cookie = `${ cookie }; SameSite=Lax`;
        }

        this.headers.append('set-cookie', cookie);

        return this;
    }

    /**
     * Configures the response as an HTTP redirect by setting the status code and Location header.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections
     *
     * @public
     * @param {number} statusCode - HTTP redirect status code (301, 302, 307, 308, etc.)
     * @param {string|URL} newLocation - Target URL for the redirect
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {AssertionError} When statusCode is not a number or newLocation is not a valid string/URL
     */
    respondWithRedirect(statusCode, newLocation) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        // Support URL objects since they're commonly used for URL construction
        if (newLocation.href) {
            newLocation = newLocation.href;
        }
        assertNonEmptyString(newLocation, ': newLocation must be a string');

        this.status = statusCode;
        this.headers.set('location', newLocation);
        return this;
    }

    /**
     * Configures the response to return JSON data with Content-Type and Content-Length headers.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the response
     * @param {*} obj - Value to serialize as JSON (must be JSON-serializable)
     * @param {Object} [options]
     * @param {number|boolean} [options.whiteSpace] - Indentation spaces (true for 4, number for exact, falsy for compact)
     * @param {string} [options.contentType] - Override default 'application/json; charset=utf-8'
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {AssertionError} When statusCode is not a number
     */
    respondWithJSON(statusCode, obj, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        options = options || {};

        // Whitespace formatting: exact number, truthy for 4-space default, or compact
        let utf8;
        if (Number.isInteger(options.whiteSpace)) {
            utf8 = JSON.stringify(obj, null, options.whiteSpace);
        } else if (options.whiteSpace) {
            utf8 = JSON.stringify(obj, null, 4);
        } else {
            utf8 = JSON.stringify(obj);
        }

        // Add trailing newline for better terminal/curl output readability
        utf8 += '\n';

        this.status = statusCode;

        if (isNonEmptyString(options.contentType)) {
            this.headers.set('content-type', options.contentType);
        } else {
            this.headers.set('content-type', 'application/json; charset=utf-8');
        }

        // Use byte length, not character count, for accurate Content-Length
        this.headers.set('content-length', this.getContentLengthForUTF8(utf8));

        this.body = utf8;

        return this;
    }

    /**
     * Configures the response to return HTML content with Content-Type and Content-Length headers.
     * Convenience wrapper around respondWithUtf8() with 'text/html' content type.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the response
     * @param {string} utf8 - HTML string content for the response body
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {AssertionError} When statusCode is not a number or utf8 is not a non-empty string
     */
    respondWithHTML(statusCode, utf8) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        assert(isNonEmptyString(utf8), ': response body must be a string');
        return this.respondWithUtf8(statusCode, utf8, { contentType: 'text/html' });
    }

    /**
     * Configures the response to return UTF-8 text content with Content-Type and Content-Length headers.
     * Appends '; charset=utf-8' to the content type automatically.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the response
     * @param {string} utf8 - UTF-8 encoded string content for the response body
     * @param {Object} [options]
     * @param {string} [options.contentType='text/html'] - MIME type (charset=utf-8 is appended)
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {AssertionError} When statusCode is not a number or utf8 is not a non-empty string
     */
    respondWithUtf8(statusCode, utf8, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        assert(isNonEmptyString(utf8), ': response body must be a string');

        options = options || {};

        this.status = statusCode;

        if (isNonEmptyString(options.contentType)) {
            this.headers.set('content-type', `${ options.contentType }; charset=utf-8`);
        } else {
            this.headers.set('content-type', 'text/html; charset=utf-8');
        }

        this.headers.set('content-length', this.getContentLengthForUTF8(utf8));

        this.body = utf8;

        return this;
    }

    /**
     * Configures the response for HTTP 304 Not Modified, indicating the client should use its cache.
     * Sets Content-Length to 0 and clears the body per RFC 9110 requirements.
     * @public
     * @returns {HttpServerResponse} This response instance for method chaining
     */
    respondNotModified() {
        const statusCode = 304;

        this.status = statusCode;

        // RFC 9110 requires Content-Length: 0 for 304 responses
        // even though there's no body - this helps caches understand the response
        this.headers.set('content-length', '0');
        this.body = null;

        return this;
    }

    /**
     * Configures the response to stream data from a readable stream.
     * Useful for large files or real-time data to avoid loading everything into memory.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the streaming response
     * @param {number} [contentLength] - Byte length for Content-Length header; omit for chunked encoding
     * @param {import('stream').Readable} readStream - Readable stream to pipe as the response body
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {AssertionError} When statusCode is not a number
     */
    respondWithStream(statusCode, contentLength, readStream) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        if (isNumberNotNaN(contentLength)) {
            this.headers.set('content-length', contentLength.toString());
        }

        this.status = statusCode;
        this.body = readStream;
        return this;
    }

    /**
     * Calculates the byte length of a UTF-8 string for accurate Content-Length headers.
     * Uses the Blob API since String.length returns character count, not byte count.
     *
     * @param {string} utf8 - String to measure
     * @returns {number} The byte length in UTF-8 encoding
     */
    getContentLengthForUTF8(utf8) {
        // String.length returns character count, but HTTP Content-Length requires
        // byte count. Multi-byte UTF-8 characters (emoji, non-ASCII) would cause
        // truncated responses if we used string length directly.
        return new Blob([ utf8 ]).size;
    }
}
