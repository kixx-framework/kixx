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
 * BaseHttpResponse provides a base class for HTTP responses, supporting
 * status, headers, body, and utility methods for common response types.
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
     * Constructs a new BaseHttpResponse.
     * @param {string|number} id - The unique identifier for this response.
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
     * Returns the custom properties object for this response.
     * The returned object is deeply frozen and should not be mutated.
     * @returns {Object} The response properties.
     */
    get props() {
        return this.#props;
    }

    /**
     * Updates the custom properties object for this response by deeply merging
     * the provided params into the existing properties. The result is deeply frozen
     * to ensure immutability. Returns the response instance for chaining.
     *
     * @param {Object} params - The properties to merge into the response's custom properties.
     * @returns {BaseHttpResponse} The response instance.
     */
    updateProps(params) {
        const mergedParams = deepMerge(structuredClone(this.#props), params);
        this.#props = deepFreeze(mergedParams);
        return this;
    }

    /**
     * Updates the response headers with the provided headers.
     * Accepts an iterable of [ key, value ] pairs (e.g., Map or Headers).
     * Each header is set on the response, replacing any existing value for the same key.
     *
     * @param {Iterable<[ string, string ]>} headers - Iterable of header key-value pairs.
     * @returns {void}
     */
    updateHeaders(headers) {
        for (const [ key, val ] of headers) {
            this.headers.set(key, val);
        }
    }

    /**
     * Sets a single header on the response.
     *
     * @param {string} key - The header name.
     * @param {string} val - The header value.
     * @returns {this} The response instance for chaining.
     */
    setHeader(key, val) {
        this.headers.set(key, val);
        return this;
    }

    /**
     * Sets a cookie on the response.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
     *
     * @param {string} key - The cookie name.
     * @param {string} val - The cookie value.
     * @param {Object} [options] - Optional. Cookie options:
     * @param {number} [options.maxAge] - Number of seconds until the cookie expires (Max-Age).
     * @param {boolean} [options.secure] - Whether the cookie is only sent over HTTPS (Secure).
     * @param {boolean} [options.httpOnly] - Whether the cookie is inaccessible to JavaScript (HttpOnly).
     * @param {'Strict'|'Lax'|'None'} [options.sameSite] - Controls the SameSite attribute ('Strict', 'Lax', or 'None').
     * @param {string} [options.path] - The path for which the cookie is valid (Path).
     * @returns {this} The response instance for chaining.
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

        if (secure || !isBoolean(secure)) {
            cookie = `${ cookie }; Secure`;
        }

        if (httpOnly || !isBoolean(httpOnly)) {
            cookie = `${ cookie }; HttpOnly`;
        }

        if (sameSite) {
            cookie = `${ cookie }; SameSite=${ sameSite }`;
        } else {
            cookie = `${ cookie }; SameSite=Lax`;
        }

        this.headers.set('set-cookie', cookie);

        return this;
    }

    /**
     * Sets the response as a redirect with the given status code and location.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections
     *
     * @param {number} statusCode - The HTTP status code for the redirect (e.g., 301, 302, 307, 308).
     * @param {string} newLocation - The URL to redirect to.
     * @returns {this} The response instance for chaining.
     */
    respondWithRedirect(statusCode, newLocation) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        if (newLocation.href) {
            newLocation = newLocation.href;
        }
        assertNonEmptyString(newLocation, ': newLocation must be a string');

        this.status = statusCode;
        this.headers.set('location', newLocation);
        return this;
    }

    /**
     * Sets the response as a JSON response with the given status code and object.
     *
     * @param {number} statusCode - The HTTP status code for the response.
     * @param {Object} obj - The JSON object to send in the response body.
     * @param {Object} [options] - Optional. JSON serialization options:
     * @param {number} [options.whiteSpace] - The number of spaces to use for indentation (0 for no whitespace, 2 for 2 spaces, etc.).
     * @param {string} [options.contentType] - The content type to use for the response (e.g., 'application/json').
     * @returns {this} The response instance for chaining.
     */
    respondWithJSON(statusCode, obj, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        options = options || {};

        let utf8;
        if (Number.isInteger(options.whiteSpace)) {
            utf8 = JSON.stringify(obj, null, options.whiteSpace);
        } else if (options.whiteSpace) {
            utf8 = JSON.stringify(obj, null, 4);
        } else {
            utf8 = JSON.stringify(obj);
        }

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
     * Sets the response as an HTML response with the given status code and UTF-8 string body.
     *
     * @param {number} statusCode - The HTTP status code for the response.
     * @param {string} utf8 - The HTML string to send in the response body.
     * @param {Object} [options="text/html; charset=utf-8"] - Optional. HTML response options:
     * @param {string} [options.contentType] - The content type to use for the response (e.g., 'text/html').
     * @returns {this} The response instance for chaining.
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
     * Sets up the response for a 304 Not Modified status.
     * This response indicates that the resource has not changed and the client can use its cached version.
     * Per RFC 9110, a 304 response must not include a message body, and the Content-Length should be set to 0.
     *
     * @returns {this} The response instance for chaining.
     */
    respondNotModified() {
        const statusCode = 304;

        this.status = statusCode;

        this.headers.set('content-length', '0');
        this.body = null;

        return this;
    }

    /**
     * Sets up the response to stream data from a readable stream.
     *
     * @param {number} statusCode - The HTTP status code to use for the response.
     * @param {number} [contentLength] - Optional. The byte length of the stream content for the Content-Length header.
     * @param {import('stream').Readable} readStream - The readable stream to use as the response body.
     * @returns {this} The response instance for chaining.
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
     * Returns the byte length of a UTF-8 string for use in the Content-Length header.
     *
     * @param {string} utf8 - The string whose UTF-8 byte length is to be calculated.
     * @returns {number} The byte length of the string in UTF-8 encoding.
     */
    getContentLengthForUTF8(utf8) {
        return new Blob([ utf8 ]).size;
    }
}
