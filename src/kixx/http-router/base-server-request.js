import { assert, isValidDate } from '../assertions/mod.js';
import {
    BadRequestError,
    UnsupportedMediaTypeError,
} from '../errors/mod.js';
import deepFreeze from '../utils/deep-freeze.js';

const FORM_DATA_CONTENT_TYPES = Object.freeze([
    'application/x-www-form-urlencoded',
    'multipart/form-data',
]);

/**
 * @typedef {Object} BodyDelegate
 * @property {ReadableStream|null} body - The request body stream, or null when the request has no body.
 * @property {boolean} bodyUsed - Whether the body stream has already been consumed.
 * @property {Function} json - Resolves to the body parsed as JSON.
 * @property {Function} text - Resolves to the body decoded as UTF-8 text.
 * @property {Function} arrayBuffer - Resolves to the body as an ArrayBuffer.
 * @property {Function} formData - Resolves to the body parsed as FormData.
 */

/**
 * The platform-independent half of the Kixx server request contract.
 *
 * Every member implemented here is expressible in terms of the Web `Headers`
 * and `URL` primitives, so it is identical on every deploy target. Platform
 * adapters extend this class and supply only what they alone can derive: the
 * request `id`, the client `ip`, the resolved `url`, the `headers`, and a body
 * delegate.
 *
 * A subclass constructor derives those values from its native request object
 * and passes them to `super()`. It must not re-implement any member defined
 * here; a fix to cookie parsing or ETag handling belongs in this class so that
 * every platform receives it at once.
 *
 * The body delegate is any object exposing the Web `Request` body surface
 * (`body`, `bodyUsed`, `json()`, `text()`, `arrayBuffer()`, `formData()`). On an
 * edge runtime the native `Request` already satisfies it. An adapter whose
 * native request is not a Web `Request` constructs one to bridge its body
 * stream, and passes that.
 *
 * @see {@link ./server-request-interface.js} for the normative contract and its invariants.
 */
export default class BaseServerRequest {

    #bodyDelegate = null;
    #hostnameParams = Object.freeze({});
    #pathnameParams = Object.freeze({});

    /**
     * Defines the immutable request properties required by the contract. All
     * five are enumerable and non-writable, so a middleware cannot reassign
     * them partway through the chain.
     *
     * @param {Object} options
     * @param {string} options.id - Unique request id used to correlate log records.
     * @param {string|null} options.ip - Originating client IP address, or null when it cannot be determined.
     * @param {string} options.method - HTTP method in UPPERCASE; lowercase silently fails route matching.
     * @param {URL} options.url - Fully resolved request URL.
     * @param {Headers} options.headers - Request headers as a Web API `Headers` instance.
     * @param {BodyDelegate} options.bodyDelegate - Supplies the body stream and the body parsers.
     */
    constructor(options) {
        const {
            id,
            ip,
            method,
            url,
            headers,
            bodyDelegate,
        } = options ?? {};

        this.#bodyDelegate = bodyDelegate;

        Object.defineProperties(this, {
            /**
             * Unique request id used to correlate log records.
             * @name id
             * @type {string}
             */
            id: {
                enumerable: true,
                value: id,
            },
            /**
             * Originating client IP address, or null when it cannot be determined.
             * @name ip
             * @type {string|null}
             */
            ip: {
                enumerable: true,
                value: ip,
            },
            /**
             * HTTP method normalized for router comparisons.
             * @name method
             * @type {string}
             */
            method: {
                enumerable: true,
                value: method,
            },
            /**
             * Fully parsed request URL.
             * @name url
             * @type {URL}
             */
            url: {
                enumerable: true,
                value: url,
            },
            /**
             * Request headers exposed through the Web API `Headers` interface.
             * @name headers
             * @type {Headers}
             */
            headers: {
                enumerable: true,
                value: headers,
            },
        });
    }

    /**
     * The request body stream. A non-null stream can only be consumed once.
     * @type {ReadableStream|null}
     */
    get body() {
        return this.#bodyDelegate.body;
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
     * @returns {boolean} `true` when the request body is URL-encoded form data
     */
    isFormURLEncodedRequest() {
        return this.getContentMediaType() === 'application/x-www-form-urlencoded';
    }

    /**
     * Returns the request Content-Type media type without parameters.
     * @returns {string} Normalized media type, or an empty string when absent
     */
    getContentMediaType() {
        const contentType = this.headers.get('content-type') ?? '';
        return contentType.split(';')[0].trim().toLowerCase();
    }

    /**
     * Sets pathname pattern params extracted by the router.
     * @param {Object<string, string|string[]>} params - Matched pathname params
     * @returns {BaseServerRequest} This request for chaining
     */
    setPathnameParams(params) {
        this.#pathnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    /**
     * Sets hostname pattern params extracted by the router.
     * @param {Object<string, string|string[]>} params - Matched hostname params
     * @returns {BaseServerRequest} This request for chaining
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
        this.#assertBodyUnread('json');

        try {
            const json = await this.#bodyDelegate.json();
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
        this.#assertBodyUnread('text');

        try {
            return await this.#bodyDelegate.text();
        } catch (cause) {
            throw new BadRequestError('Request body could not be read as text', { cause }, this.text);
        }
    }

    /**
     * Reads the request body as raw bytes.
     *
     * The whole body is buffered in memory with no size limit, matching the
     * other read methods. A handler accepting untrusted uploads should use
     * `bufferRequestBodyWithLimit()` from
     * `app/presentation/lib/read-request-body.js` instead, which streams the
     * body under a hard byte cap and aborts once the cap is crossed.
     *
     * A read failure rejects with `BadRequestError` rather than the `TypeError`
     * the Web platform specifies for `Request#arrayBuffer()`. The deviation is
     * deliberate: a truncated or unreadable body is a client fault, and the
     * project error pipeline turns an expected error into a 400 while an
     * unwrapped `TypeError` would surface as a 500.
     *
     * @returns {Promise<ArrayBuffer>} The request body bytes; empty for a bodyless request
     * @throws {BadRequestError} When the body cannot be read
     */
    async arrayBuffer() {
        this.#assertBodyUnread('arrayBuffer');

        try {
            return await this.#bodyDelegate.arrayBuffer();
        } catch (cause) {
            throw new BadRequestError('Request body could not be read as bytes', { cause }, this.arrayBuffer);
        }
    }

    /**
     * Reads and parses the request body as form data.
     * @returns {Promise<FormData>} Parsed form data
     * @throws {UnsupportedMediaTypeError} When the content type is missing or unsupported.
     * @throws {BadRequestError} When the body cannot be parsed as form data.
     */
    async formData() {
        const contentType = this.getContentMediaType();

        if (!FORM_DATA_CONTENT_TYPES.includes(contentType)) {
            throw new UnsupportedMediaTypeError(
                'Content-Type must be application/x-www-form-urlencoded or multipart/form-data',
                { accept: FORM_DATA_CONTENT_TYPES },
                this.formData,
            );
        }

        // The media type check comes first: an unsupported Content-Type is a
        // fact about the request as sent, and stays a 415 whether or not the
        // body has already been consumed.
        this.#assertBodyUnread('formData');

        try {
            return await this.#bodyDelegate.formData();
        } catch (cause) {
            throw new BadRequestError('Request body could not be parsed as form data', { cause }, this.formData);
        }
    }

    /**
     * Asserts the body has not already been consumed.
     *
     * A request body can be read only once, so a second read is a bug in the
     * middleware chain rather than a bad request, and must not be reported as
     * one. The check runs before the delegate is called because the delegate
     * signals reuse with a `TypeError` whose wording differs per platform;
     * inspecting that error would make the classification platform-dependent.
     *
     * Both flags matter: `bodyUsed` covers a completed read, while a stream
     * locked by `getReader()` but not yet pulled from leaves `bodyUsed` false
     * and still poisons the delegate. A bodyless request trips neither, so
     * repeated reads of one stay legal.
     *
     * @param {string} methodName - Calling method, named in the assertion message
     * @throws {AssertionError} When the body has already been consumed
     */
    #assertBodyUnread(methodName) {
        const delegate = this.#bodyDelegate;

        assert(
            !delegate.bodyUsed && !delegate.body?.locked,
            `ServerRequest#${ methodName }(): the request body has already been read`,
        );
    }
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
