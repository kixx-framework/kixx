import { WrappedError } from '../errors/mod.js';
import deepMerge from '../utils/deep-merge.js';
import {
    assertMatches,
    assertNumberNotNaN,
    assertNonEmptyString,
    isBoolean,
    isNonEmptyString,
    isNumberNotNaN,
    isPlainObject,
} from '../assertions/mod.js';


/**
 * Represents an HTTP response being built as it travels through the middleware pipeline.
 *
 * Middleware handlers configure the response by setting the mutable `status` and `body`
 * properties directly, or via the specialized `respond*` methods for common content types.
 * Cookie management and header manipulation are also provided.
 */
export default class ServerResponse {

    /**
     * Custom properties for passing data between middleware handlers.
     * @type {Object}
     */
    #props = {};

    constructor() {

        /**
         * HTTP status code for the response.
         * @type {number}
         */
        this.status = 200;

        /**
         * Response body: string, Buffer, or readable stream.
         * @type {string|Buffer|ReadableStream|import('stream').Readable|null}
         */
        this.body = null;

        Object.defineProperties(this, {
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
     *
     * The returned object is mutable; use updateProps() to merge new values.
     *
     * @public
     * @returns {Object} The response properties object.
     */
    get props() {
        return this.#props;
    }

    /**
     * Deeply merges new properties into the response's custom properties object.
     * @public
     * @param {Object} params - Plain object properties to merge into existing custom properties.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {WrappedError} When `params` cannot be cloned or is not a plain object.
     */
    updateProps(params) {
        try {
            this.#props = deepMerge(this.#props, structuredClone(params));
        } catch (cause) {
            throw new WrappedError(
                'Cannot clone and merge response props; try passing a plain object instead.',
                { cause },
            );
        }
        return this;
    }

    /**
     * Sets a header on the response, replacing any existing value for that header name.
     * @public
     * @param {string} key - The header name.
     * @param {string} val - The header value.
     * @returns {ServerResponse} This response instance for method chaining.
     */
    setHeader(key, val) {
        this.headers.set(key, val);
        return this;
    }

    /**
     * Appends a value to a header, allowing multiple values for the same header name.
     * Useful for headers like Set-Cookie that can appear multiple times.
     * @public
     * @param {string} key - The header name.
     * @param {string} val - The header value to append.
     * @returns {ServerResponse} This response instance for method chaining.
     */
    appendHeader(key, val) {
        this.headers.append(key, val);
        return this;
    }

    /**
     * Sets a cookie on the response with secure defaults (Secure, HttpOnly, SameSite=Lax).
     * Cookie values are encoded with encodeURIComponent to safely handle special characters.
     * Pass explicit false to disable individual security attributes when needed.
     * @public
     * @param {string} key - The cookie name.
     * @param {string} val - The cookie value; encoded with encodeURIComponent before being set.
     * @param {Object} [options]
     * @param {number} [options.maxAge] - Seconds until expiration; omit for a session cookie.
     * @param {string} [options.domain] - Domain scope (e.g. '.example.com' for subdomains).
     * @param {boolean} [options.secure=true] - HTTPS only; set false for local development.
     * @param {boolean} [options.httpOnly=true] - Block JavaScript access; set false for client-readable cookies.
     * @param {'Strict'|'Lax'|'None'} [options.sameSite='Lax'] - Cross-site request policy.
     * @param {string} [options.path] - URL path scope for the cookie.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {AssertionError} When cookie name or options contain invalid Set-Cookie syntax.
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
     */
    setCookie(key, val, options) {
        validateCookieName(key);

        const {
            maxAge,
            domain,
            secure,
            httpOnly,
            sameSite,
            path,
        } = options || {};

        validateCookieOptions({ maxAge, domain, sameSite, path });

        const encodedVal = encodeURIComponent(String(val));

        let cookie = `${ key }=${ encodedVal }`;

        if (isNumberNotNaN(maxAge)) {
            cookie = `${ cookie }; Max-Age=${ maxAge }`;
        }

        if (domain) {
            cookie = `${ cookie }; Domain=${ domain }`;
        }

        if (path) {
            cookie = `${ cookie }; Path=${ path }`;
        }

        // Default to Secure unless explicitly set to false
        if (secure || !isBoolean(secure)) {
            cookie = `${ cookie }; Secure`;
        }

        // Default to HttpOnly unless explicitly set to false; blocks XSS access to the cookie
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
     * Clears a cookie by setting it to an empty value with Max-Age=0.
     * The path (and optionally domain) must match the cookie that was set.
     * @public
     * @param {string} key - The cookie name to clear.
     * @param {Object} [options]
     * @param {string} [options.path='/'] - Path scope; must match the original cookie.
     * @param {string} [options.domain] - Domain scope; must match the original cookie if it was set.
     * @returns {ServerResponse} This response instance for method chaining.
     */
    clearCookie(key, options) {
        const path = options?.path ?? '/';
        this.setCookie(key, '', { maxAge: 0, path, domain: options?.domain });
        return this;
    }

    /**
     * Generic response method for setting status, headers, and body in one call.
     * More flexible than specialized respond methods when you need full control.
     *
     * @public
     * @param {number} [statusCode] - HTTP status code for the response.
     * @param {Object|Headers|Array<[string,string]>} [headers] - Headers to set. Use setCookie() for Set-Cookie headers.
     * @param {*} [body] - Response body.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     */
    respond(statusCode, headers, body) {
        if (isNumberNotNaN(statusCode)) {
            this.status = statusCode;
        }

        this.#applyHeaders(headers);

        if (body !== undefined) {
            this.body = body;
        }

        return this;
    }

    /**
     * Configures the response as an HTTP redirect by setting the status code and Location header.
     * @public
     * @param {number} statusCode - HTTP redirect status code.
     * @param {string|URL} newLocation - Target URL for the redirect.
     * @param {Object} [options]
     * @param {Object|Headers|Array<[string,string]>} [options.headers] - Additional headers to set. Use setCookie() for Set-Cookie headers.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {AssertionError} When statusCode is not a number or newLocation is not a non-empty string or URL.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections
     */
    respondWithRedirect(statusCode, newLocation, options) {
        assertNumberNotNaN(statusCode, ': statusCode must be a number');

        if (newLocation instanceof URL) {
            newLocation = newLocation.href;
        }
        assertNonEmptyString(newLocation, ': newLocation must be a string');

        this.status = statusCode;
        this.headers.set('location', newLocation);

        this.#applyHeaders(options?.headers);

        return this;
    }

    /**
     * Configures the response to return JSON data with Content-Type and Content-Length headers.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the response.
     * @param {*} obj - Value to serialize as JSON.
     * @param {Object} [options]
     * @param {number|boolean} [options.whiteSpace] - Indentation spaces: true for 4, number for exact, falsy for compact.
     * @param {string} [options.contentType='application/json'] - MIME type; charset=utf-8 is appended.
     * @param {Object|Headers|Array<[string,string]>} [options.headers] - Additional headers to set. Use setCookie() for Set-Cookie headers.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {AssertionError} When statusCode is not a number or JSON.stringify() returns undefined.
     * @throws {TypeError} When JSON.stringify() rejects the value, such as circular objects or BigInt values.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     */
    respondWithJSON(statusCode, obj, options) {
        assertNumberNotNaN(statusCode, ': statusCode must be a number');

        options = { ...options };

        let utf8;
        if (Number.isInteger(options.whiteSpace)) {
            utf8 = JSON.stringify(obj, null, options.whiteSpace);
        } else if (options.whiteSpace) {
            utf8 = JSON.stringify(obj, null, 4);
        } else {
            utf8 = JSON.stringify(obj);
        }
        assertNonEmptyString(utf8, ': response body must serialize to JSON');

        // Add trailing newline for better terminal/curl output readability
        utf8 += '\n';

        options.contentType = options.contentType || 'application/json';

        return this.respondWithUtf8(statusCode, utf8, options);
    }

    /**
     * Configures the response to return HTML content with Content-Type and Content-Length headers.
     * Convenience wrapper around respondWithUtf8() with 'text/html' content type.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the response.
     * @param {string} utf8 - HTML string content for the response body.
     * @param {Object} [options]
     * @param {string} [options.contentType='text/html'] - MIME type; charset=utf-8 is appended.
     * @param {Object|Headers|Array<[string,string]>} [options.headers] - Additional headers to set. Use setCookie() for Set-Cookie headers.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {AssertionError} When statusCode is not a number or utf8 is not a non-empty string.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     */
    respondWithHTML(statusCode, utf8, options) {
        assertNumberNotNaN(statusCode, ': statusCode must be a number');
        assertNonEmptyString(utf8, ': response body must be a string');

        options = { ...options };
        options.contentType = options.contentType ?? 'text/html';

        return this.respondWithUtf8(statusCode, utf8, options);
    }

    /**
     * Configures the response to return UTF-8 text content with Content-Type and Content-Length headers.
     * Appends '; charset=utf-8' to the content type automatically.
     * Default contentType is 'text/plain' when not specified.
     *
     * @public
     * @param {number} statusCode - HTTP status code for the response.
     * @param {string} utf8 - UTF-8 encoded string content for the response body.
     * @param {Object} [options]
     * @param {string} [options.contentType='text/plain'] - MIME type; charset=utf-8 is appended.
     * @param {Object|Headers|Array<[string,string]>} [options.headers] - Additional headers to set. Use setCookie() for Set-Cookie headers.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {AssertionError} When statusCode is not a number or utf8 is not a non-empty string.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     */
    respondWithUtf8(statusCode, utf8, options) {
        assertNumberNotNaN(statusCode, ': statusCode must be a number');
        assertNonEmptyString(utf8, ': response body must be a string');

        options = { ...options };

        this.status = statusCode;

        const contentType = normalizeContentType(options.contentType);

        if (isNonEmptyString(contentType)) {
            this.headers.set('content-type', `${ contentType }; charset=utf-8`);
        } else {
            this.headers.set('content-type', 'text/plain; charset=utf-8');
        }

        // String.length returns character count, but HTTP Content-Length requires
        // byte count. Multi-byte UTF-8 characters (emoji, non-ASCII) would cause
        // truncated responses if we used string length directly.
        const contentLength = new Blob([ utf8 ]).size;

        this.headers.set('content-length', contentLength);

        this.body = utf8;

        this.#applyHeaders(options.headers);

        return this;
    }

    /**
     * Configures the response to stream data from a readable stream.
     * Useful for large files or real-time data to avoid loading everything into memory.
     * Pass null for readStream when handling HEAD requests (no body, headers only).
     *
     * @public
     * @param {number} statusCode - HTTP status code for the streaming response.
     * @param {ReadableStream|import('stream').Readable|null} readStream - Readable stream to pipe, or null for HEAD responses.
     * @param {Object} [options]
     * @param {string} [options.contentType] - Content-Type header.
     * @param {number} [options.contentLength] - Byte length for Content-Length header; omit for chunked encoding.
     * @param {Object|Headers|Array<[string,string]>} [options.headers] - Additional headers to set. Use setCookie() for Set-Cookie headers.
     * @returns {ServerResponse} This response instance for method chaining.
     * @throws {AssertionError} When statusCode is not a number.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     */
    respondWithStream(statusCode, readStream, options) {
        assertNumberNotNaN(statusCode, ': statusCode must be a number');

        options = { ...options };

        this.status = statusCode;
        this.body = readStream;

        if (isNonEmptyString(options.contentType)) {
            this.headers.set('content-type', options.contentType);
        }

        if (isNumberNotNaN(options.contentLength)) {
            this.headers.set('content-length', options.contentLength.toString());
        }

        this.#applyHeaders(options.headers);

        return this;
    }

    /**
     * Converts headers from various formats into entries and applies them to this response.
     * @param {Object|Headers|Array<[string,string]>} [headers] - Headers to apply.
     * @throws {TypeError} When headers are not a plain object, Headers instance, or entries array.
     */
    #applyHeaders(headers) {
        if (!headers) {
            return;
        }

        let entries;
        if (headers instanceof Headers) {
            entries = headers.entries();
        } else if (Array.isArray(headers)) {
            entries = headers;
        } else if (isPlainObject(headers)) {
            entries = Object.entries(headers);
        } else {
            throw new TypeError('Headers must be a plain object, Headers instance, or entries array.');
        }

        for (const [ key, value ] of entries) {
            this.headers.set(key, value);
        }
    }
}

function validateCookieName(key) {
    assertNonEmptyString(key, ': cookie name must be a string');
    assertMatches(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, key, ': cookie name contains invalid characters');
}

function validateCookieOptions({ maxAge, domain, sameSite, path }) {
    if (maxAge !== undefined) {
        assertNumberNotNaN(maxAge, ': cookie maxAge must be a number');
        assertMatches(/^-?\d+$/, String(maxAge), ': cookie maxAge must be an integer');
    }

    if (domain !== undefined) {
        assertNonEmptyString(domain, ': cookie domain must be a string');
        assertMatches(/^[A-Za-z0-9.-]+$/, domain, ': cookie domain contains invalid characters');
    }

    if (path !== undefined) {
        assertNonEmptyString(path, ': cookie path must be a string');
        assertMatches(/^[\u0020-\u003A\u003C-\u007E]+$/, path, ': cookie path contains invalid characters');
    }

    if (sameSite !== undefined) {
        assertMatches(/^(Strict|Lax|None)$/, sameSite, ': cookie sameSite must be Strict, Lax, or None');
    }
}

function normalizeContentType(contentType) {
    if (!isNonEmptyString(contentType)) {
        return null;
    }

    return contentType.split(';')[0].trim();
}
