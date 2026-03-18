/**
 * ServerResponse port — the contract for the HTTP response object built up as
 * it travels through the Kixx middleware pipeline.
 *
 * Unlike most ports, this contract has a single canonical implementation:
 * `lib/http/ServerResponse`. Because `ServerResponse` is built entirely on
 * Web APIs (`Headers`, `Blob`) with no platform-specific code, the same class
 * works on Node.js, Cloudflare Workers, and any other target — no per-platform
 * adapter is needed.
 *
 * ## Invariants
 * - `id` MUST be immutable after construction
 * - `status` MUST default to 200 at construction; middleware sets it via
 *   `respond*` methods or by assigning directly
 * - `body` MUST default to `null` at construction
 * - `headers` MUST be a Web API `Headers` instance, created fresh at
 *   construction (case-insensitive, supports multiple values per key)
 * - All `respond*` methods MUST return `this` to allow method chaining
 * - `updateProps()` MUST deep-merge via `structuredClone` and MUST return
 *   `this`; it MUST throw `WrappedError` when the params cannot be cloned
 * - `setCookie()` MUST encode the cookie value with `encodeURIComponent`;
 *   MUST default `Secure` and `HttpOnly` to true; MUST default `SameSite`
 *   to `'Lax'` when no `sameSite` option is given
 * - `clearCookie()` MUST set `Max-Age=0` and default `path` to `'/'` when
 *   not provided
 * - `respondWithUtf8()` MUST set `Content-Length` to the UTF-8 byte count
 *   (not character count) using `new Blob([utf8]).size`
 * - `respondWithJSON()` MUST append a trailing newline `'\n'` to the
 *   serialized JSON body
 *
 * @module ports/http-server-response
 */

/**
 * HTTP response object built up as it travels through the middleware pipeline.
 *
 * The canonical implementation is `lib/http/ServerResponse`.
 *
 * @typedef {Object} ServerResponse
 *
 * @property {string|number} id
 *   Unique identifier correlating this response with its originating request.
 *   Immutable after construction.
 *
 * @property {number} status
 *   HTTP status code. Defaults to 200. Set directly or via `respond*` methods.
 *
 * @property {string|Buffer|import('stream').Readable|null} body
 *   Response body. Defaults to `null`. Set directly or via `respond*` methods.
 *   Accepts a string, Buffer, or Node.js Readable stream.
 *
 * @property {Headers} headers
 *   Web API `Headers` instance for managing response headers. Created fresh at
 *   construction. Use `setHeader()` / `appendHeader()` for mutation, or pass
 *   headers to a `respond*` method.
 *
 * @property {Object} props
 *   Custom properties for passing data between middleware handlers in the same
 *   pipeline. Mutable; use `updateProps()` to merge new values.
 *
 * @property {function(Object): ServerResponse} updateProps
 *   Deep-merges `params` into `props` via `structuredClone` and returns `this`.
 *   Throws `WrappedError` when `params` cannot be cloned (e.g. contains a
 *   function).
 *
 * @property {function(string, string): ServerResponse} setHeader
 *   Sets a response header, replacing any existing value. Returns `this`.
 *
 * @property {function(string, string): ServerResponse} appendHeader
 *   Appends a value to a header, preserving existing values. Returns `this`.
 *   Use for headers that allow multiple values, such as `Set-Cookie`.
 *
 * @property {function(string, string, Object=): ServerResponse} setCookie
 *   Appends a `Set-Cookie` header. Encodes the value with `encodeURIComponent`.
 *   Defaults: `Secure=true`, `HttpOnly=true`, `SameSite=Lax`.
 *   Options: `maxAge` (number), `domain` (string), `path` (string),
 *   `secure` (boolean), `httpOnly` (boolean), `sameSite` ('Strict'|'Lax'|'None').
 *   Returns `this`.
 *
 * @property {function(string, Object=): ServerResponse} clearCookie
 *   Clears a cookie by setting it to an empty value with `Max-Age=0`.
 *   `path` defaults to `'/'` when not provided. Returns `this`.
 *
 * @property {function(number=, Object|Headers|Array=, *=): ServerResponse} respond
 *   Generic response method. Sets `status`, merges headers (object, `Headers`
 *   instance, or `[name, value]` entries array), and sets `body`. Returns `this`.
 *
 * @property {function(number, string|URL, Object=): ServerResponse} respondWithRedirect
 *   Sets `status` and the `Location` header. Accepts a `URL` object or string
 *   for `newLocation`. Throws `AssertionError` when `statusCode` is not a number
 *   or `newLocation` is empty. Returns `this`.
 *
 * @property {function(number, *, Object=): ServerResponse} respondWithJSON
 *   Serializes `obj` as JSON, sets `Content-Type: application/json; charset=utf-8`
 *   and `Content-Length`, appends a trailing newline, and sets `body`.
 *   `options.whiteSpace`: integer for exact indent, `true` for 4-space indent,
 *   falsy for compact. Throws `AssertionError` when `statusCode` is not a number.
 *   Returns `this`.
 *
 * @property {function(number, string, Object=): ServerResponse} respondWithHTML
 *   Convenience wrapper around `respondWithUtf8()` with `text/html` content type.
 *   Throws `AssertionError` when `statusCode` is not a number or `utf8` is empty.
 *   Returns `this`.
 *
 * @property {function(number, string, Object=): ServerResponse} respondWithUtf8
 *   Sets `Content-Type` (defaults to `text/plain; charset=utf-8`),
 *   `Content-Length` (byte count via `new Blob([utf8]).size`), and `body`.
 *   Throws `AssertionError` when `statusCode` is not a number or `utf8` is empty.
 *   Returns `this`.
 *
 * @property {function(number, import('stream').Readable|null, Object=): ServerResponse} respondWithStream
 *   Sets `status`, `body` (a Readable stream, or `null` for HEAD responses),
 *   and optionally `Content-Type` / `Content-Length` from options.
 *   Throws `AssertionError` when `statusCode` is not a number. Returns `this`.
 */
