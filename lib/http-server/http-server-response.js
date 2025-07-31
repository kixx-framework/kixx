/**
 * @fileoverview HTTP response builder and utilities for Node.js web servers
 *
 * This module provides the HttpServerResponse class for constructing HTTP responses
 * with fluent API methods for setting status codes, headers, cookies, and response bodies.
 * Supports common response types including JSON, HTML, redirects, and streaming responses.
 */

import deepFreeze from '../lib/deep-freeze.js';
import deepMerge from '../lib/deep-merge.js';
import {
    assert,
    assertNonEmptyString,
    isNonEmptyString,
    isNumberNotNaN,
    isBoolean
} from '../assertions/mod.js';

/**
 * @typedef {Object} CookieOptions
 * @property {number} [maxAge] - Number of seconds until the cookie expires (Max-Age)
 * @property {boolean} [secure] - Whether the cookie is only sent over HTTPS (Secure)
 * @property {boolean} [httpOnly] - Whether the cookie is inaccessible to JavaScript (HttpOnly)
 * @property {'Strict'|'Lax'|'None'} [sameSite] - Controls the SameSite attribute
 * @property {string} [path] - The path for which the cookie is valid (Path)
 */

/**
 * @typedef {Object} JSONResponseOptions
 * @property {number} [whiteSpace] - Number of spaces for JSON indentation (0 for compact)
 * @property {string} [contentType] - Custom content type header value
 */

/**
 * @typedef {Object} HTMLResponseOptions
 * @property {string} [contentType] - Custom content type header value
 */

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
     * @throws {TypeError} When id is not provided or is invalid type
     */
    constructor(id) {
        /**
         * @type {number}
         * @description HTTP status code for the response.
         */
        this.status = 200;

        /**
         * @type {Headers}
         * @description Headers object for the response.
         */
        this.headers = new Headers();

        /**
         * @type {*}
         * @description The response body. Can be string, Buffer, stream, etc.
         */
        this.body = null;

        Object.defineProperties(this, {
            id: {
                enumerable: true,
                value: id,
            },
        });
    }

    /**
     * Retrieves the custom properties object for this response.
     * Properties are deeply frozen to prevent accidental mutation.
     * @returns {Object} The immutable response properties object
     */
    get props() {
        return this.#props;
    }

    /**
     * Merges new properties into the response's custom properties object.
     * Performs a deep merge and freezes the result for immutability.
     * @param {Object} params - Properties to merge into existing custom properties
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {TypeError} When params is not an object
     *
     * @example
     * response.updateProps({ userId: '123', theme: 'dark' });
     * response.updateProps({ metadata: { version: '1.0' } });
     */
    updateProps(params) {
        // Clone existing props first to avoid mutating frozen object during merge
        const mergedParams = deepMerge(structuredClone(this.#props), params);
        this.#props = deepFreeze(mergedParams);
        return this;
    }

    /**
     * Updates response headers from an iterable of key-value pairs.
     * Replaces any existing values for the same header keys.
     * @param {Iterable<[string, string]>} headers - Iterable of header key-value pairs (Map, Headers, Array)
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {TypeError} When headers is not iterable or contains invalid key-value pairs
     *
     * @example
     * // Using a Map
     * const headerMap = new Map([['x-api-version', '1.0'], ['x-request-id', '123']]);
     * response.updateHeaders(headerMap);
     *
     * @example
     * // Using an array of arrays
     * response.updateHeaders([['content-encoding', 'gzip'], ['cache-control', 'no-cache']]);
     */
    updateHeaders(headers) {
        for (const [ key, val ] of headers) {
            this.headers.set(key, val);
        }
        return this;
    }

    /**
     * Sets a single header on the response, replacing any existing value.
     * @param {string} key - The header name
     * @param {string} val - The header value
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {TypeError} When key or val are not strings
     */
    setHeader(key, val) {
        this.headers.set(key, val);
        return this;
    }

    /**
     * Sets a cookie on the response with security defaults.
     * Defaults to Secure, HttpOnly, and SameSite=Lax for security best practices.
     * @param {string} key - The cookie name
     * @param {string} val - The cookie value
     * @param {CookieOptions} [options] - Cookie configuration options
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {TypeError} When key or val are not strings
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
     *
     * @example
     * // Basic secure cookie with defaults
     * response.setCookie('sessionId', 'abc123');
     *
     * @example
     * // Custom cookie with explicit options
     * response.setCookie('preferences', 'dark-mode', {
     *   maxAge: 86400,
     *   path: '/app',
     *   sameSite: 'Strict',
     *   secure: true,
     *   httpOnly: false
     * });
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

        this.headers.set('set-cookie', cookie);

        return this;
    }

    /**
     * Configures the response as an HTTP redirect with proper status code and location header.
     * @param {number} statusCode - HTTP redirect status code (301, 302, 307, 308, etc.)
     * @param {string|URL} newLocation - Target URL for the redirect
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {Error} When statusCode is not a valid number
     * @throws {Error} When newLocation is not a valid string or URL
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections
     *
     * @example
     * // Permanent redirect
     * response.respondWithRedirect(301, 'https://example.com/new-path');
     *
     * @example
     * // Temporary redirect with URL object
     * const targetUrl = new URL('/login', 'https://example.com');
     * response.respondWithRedirect(302, targetUrl);
     */
    respondWithRedirect(statusCode, newLocation) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        // Handle URL objects by extracting the href property
        if (newLocation.href) {
            newLocation = newLocation.href;
        }
        assertNonEmptyString(newLocation, ': newLocation must be a string');

        this.status = statusCode;
        this.headers.set('location', newLocation);
        return this;
    }

    /**
     * Configures the response to return JSON data with proper content type and encoding.
     * Automatically sets Content-Type, Content-Length, and UTF-8 encoding headers.
     * @param {number} statusCode - HTTP status code for the response
     * @param {*} obj - Object to serialize as JSON response body
     * @param {JSONResponseOptions} [options] - JSON formatting and content type options
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {Error} When statusCode is not a valid number
     * @throws {TypeError} When obj cannot be serialized to JSON
     *
     * @example
     * // Simple JSON response
     * response.respondWithJSON(200, { success: true, data: users });
     *
     * @example
     * // Pretty-printed JSON with custom content type
     * response.respondWithJSON(201, { id: 123 }, {
     *   whiteSpace: 2,
     *   contentType: 'application/vnd.api+json'
     * });
     */
    respondWithJSON(statusCode, obj, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        options = options || {};

        // Handle different whitespace formatting options for JSON output
        let utf8;
        if (Number.isInteger(options.whiteSpace)) {
            // Use exact number of spaces specified
            utf8 = JSON.stringify(obj, null, options.whiteSpace);
        } else if (options.whiteSpace) {
            // Default to 4 spaces for pretty-printing when truthy but not a number
            utf8 = JSON.stringify(obj, null, 4);
        } else {
            // Compact JSON output for production
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

        this.headers.set('content-length', this.getContentLengthForUTF8(utf8));

        this.body = utf8;

        return this;
    }

    /**
     * Configures the response to return HTML content with proper content type and encoding.
     * Automatically sets Content-Type, Content-Length, and UTF-8 encoding headers.
     * @param {number} statusCode - HTTP status code for the response
     * @param {string} utf8 - HTML string content for the response body
     * @param {HTMLResponseOptions} [options] - HTML response configuration options
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {Error} When statusCode is not a valid number
     * @throws {Error} When utf8 is not a non-empty string
     *
     * @example
     * // Basic HTML response
     * const html = '<html><body><h1>Welcome</h1></body></html>';
     * response.respondWithHTML(200, html);
     *
     * @example
     * // HTML with custom content type
     * response.respondWithHTML(200, htmlString, {
     *   contentType: 'application/xhtml+xml; charset=utf-8'
     * });
     */
    respondWithHTML(statusCode, utf8, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        assert(isNonEmptyString(utf8), ': response body must be a string');

        options = options || {};

        this.status = statusCode;

        if (isNonEmptyString(options.contentType)) {
            this.headers.set('content-type', options.contentType);
        } else {
            this.headers.set('content-type', 'text/html; charset=utf-8');
        }

        this.headers.set('content-length', this.getContentLengthForUTF8(utf8));

        this.body = utf8;

        return this;
    }

    /**
     * Configures the response for HTTP 304 Not Modified status with proper headers.
     * Indicates that the resource has not changed and the client can use its cached version.
     * Sets Content-Length to 0 and clears the response body per RFC 9110 requirements.
     * @returns {HttpServerResponse} This response instance for method chaining
     *
     * @example
     * // Check if client's cached version is still valid
     * if (clientETag === currentETag) {
     *   return response.respondNotModified();
     * }
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
     * Useful for serving large files or real-time data without loading everything into memory.
     * @param {number} statusCode - HTTP status code for the streaming response
     * @param {number} [contentLength] - Total byte length of the stream content for Content-Length header
     * @param {import('stream').Readable} readStream - Readable stream to use as the response body
     * @returns {HttpServerResponse} This response instance for method chaining
     * @throws {Error} When statusCode is not a valid number
     *
     * @example
     * // Stream a file without content length
     * const fileStream = fs.createReadStream('large-file.pdf');
     * response.respondWithStream(200, undefined, fileStream);
     *
     * @example
     * // Stream with known content length
     * const stats = fs.statSync('video.mp4');
     * const videoStream = fs.createReadStream('video.mp4');
     * response.respondWithStream(200, stats.size, videoStream);
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
     * Calculates the accurate byte length of a UTF-8 string for Content-Length headers.
     * Uses Blob API to determine actual byte count rather than character count,
     * which is crucial for proper HTTP Content-Length handling with multi-byte characters.
     * @param {string} utf8 - String whose UTF-8 byte length should be calculated
     * @returns {number} The byte length of the string in UTF-8 encoding
     * @throws {TypeError} When utf8 is not a string
     *
     * @example
     * // ASCII characters: 5 bytes
     * response.getContentLengthForUTF8('hello'); // returns 5
     *
     * @example
     * // Multi-byte UTF-8 characters: more than character count
     * response.getContentLengthForUTF8('héllo'); // returns 6 (not 5)
     */
    getContentLengthForUTF8(utf8) {
        // Use Blob.size to get accurate UTF-8 byte length
        // String.length gives character count, not byte count for multi-byte UTF-8
        return new Blob([ utf8 ]).size;
    }
}
