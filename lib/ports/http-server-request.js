/**
 * ServerRequest port — the contract for the HTTP request object passed through
 * the Kixx router and middleware pipeline.
 *
 * The router (core) depends on this interface to resolve routes and stamp
 * hostname/pathname parameters onto the request before invoking middleware.
 * Middleware (application code) depends on it for reading request data.
 *
 * ## Adapters
 * Each deployment target provides one adapter that satisfies this contract:
 * - Node.js: `lib/node-http-server/ServerRequest` (wraps `http.IncomingMessage`)
 * - Cloudflare Workers: a thin wrapper around the native `Request` object,
 *   which already exposes `method`, `url`, `headers`, `body`, `json()`, and
 *   `formData()` — only the Kixx-specific properties need to be added.
 *
 * ## Invariants
 * - `id` MUST be immutable after construction; MUST be unique per request
 *   within a server lifetime
 * - `method` MUST be the HTTP method in UPPERCASE (e.g., 'GET', 'POST')
 * - `url` MUST be a fully parsed `URL` instance with `hostname`, `pathname`,
 *   and `searchParams` available
 * - `headers` MUST be a Web API `Headers` instance (case-insensitive access)
 * - `body` MUST be a Web API `ReadableStream`; it can only be consumed once —
 *   adapters MUST NOT allow the stream to be read before middleware runs
 * - `hostnameParams` and `pathnameParams` MUST be empty frozen objects at
 *   construction; the router calls `setHostnameParams()` and
 *   `setPathnameParams()` before invoking the middleware chain
 * - `setHostnameParams()` and `setPathnameParams()` MUST freeze a clone of
 *   the params object (preventing mutation by middleware) and MUST return
 *   `this` for chaining
 * - `json()` MUST reject with `BadRequestError` when the body is not valid
 *   JSON (rather than a raw `SyntaxError`) so the error handler pipeline
 *   surfaces a 400 response automatically
 * - `ifModifiedSince` MUST return `null` when the header is absent or
 *   contains an unparseable date
 * - `ifNoneMatch` MUST return `null` when the header is absent; MUST strip
 *   surrounding quotes from strong ETags (e.g., `"abc"` → `"abc"` without
 *   quotes); MUST return weak ETags (e.g., `W/"abc"`) as-is
 *
 * @module ports/http-server-request
 */

/**
 * HTTP request object for the Kixx router and middleware pipeline.
 *
 * @typedef {Object} ServerRequest
 *
 * @property {string} id
 *   Unique identifier for this request. Used for log correlation and for
 *   matching a response back to its originating request.
 *
 * @property {string} method
 *   HTTP method in uppercase: 'GET', 'POST', 'PUT', 'DELETE', etc.
 *
 * @property {URL} url
 *   Fully parsed request URL. Provides `hostname`, `pathname`, `searchParams`,
 *   `href`, etc.
 *
 * @property {Headers} headers
 *   Web API `Headers` instance. Access is case-insensitive per the spec.
 *
 * @property {ReadableStream} body
 *   Web API `ReadableStream` for the request body. Can only be consumed once.
 *
 * @property {Object<string, string>} hostnameParams
 *   Frozen object of parameters extracted from the matched hostname pattern.
 *   Empty object until the router calls `setHostnameParams()`.
 *   Example: pattern `{tenant}.example.com`, host `acme.example.com`
 *   → `{ tenant: 'acme' }`.
 *
 * @property {Object<string, string>} pathnameParams
 *   Frozen object of parameters extracted from the matched pathname pattern.
 *   Empty object until the router calls `setPathnameParams()`.
 *   Example: pattern `/users/{id}`, path `/users/123` → `{ id: '123' }`.
 *
 * @property {Object<string, string|string[]>} queryParams
 *   Query parameters parsed from `url.searchParams`. Keys with multiple values
 *   are returned as arrays; single-value keys are returned as strings.
 *
 * @property {Date|null} ifModifiedSince
 *   Parsed `If-Modified-Since` header for conditional GET cache validation.
 *   Returns `null` when the header is absent or contains an invalid date.
 *
 * @property {string|null} ifNoneMatch
 *   Parsed `If-None-Match` header for conditional GET ETag validation.
 *   Returns the first ETag value with surrounding quotes stripped for strong
 *   ETags. Returns `null` when the header is absent.
 *
 * @property {function(Object<string, string>): ServerRequest} setHostnameParams
 *   Called by the router after hostname pattern matching. Sets `hostnameParams`
 *   to a frozen clone of the given params object. Returns `this` for chaining.
 *
 * @property {function(Object<string, string>): ServerRequest} setPathnameParams
 *   Called by the router after pathname pattern matching. Sets `pathnameParams`
 *   to a frozen clone of the given params object. Returns `this` for chaining.
 *
 * @property {function(): boolean} isHeadRequest
 *   Returns `true` when `method` is `'HEAD'`. Useful for skipping body
 *   generation while still returning correct response headers.
 *
 * @property {function(): boolean} isJSONRequest
 *   Returns `true` when the URL ends with `.json` or the `Accept` header
 *   includes `application/json`.
 *
 * @property {function(): boolean} isFormURLEncodedRequest
 *   Returns `true` when the `Content-Type` header includes
 *   `application/x-www-form-urlencoded`.
 *
 * @property {function(string): string|null} getCookie
 *   Returns the value of the named cookie, or `null` if not present.
 *
 * @property {function(): Object<string, string>|null} getCookies
 *   Parses the `Cookie` header and returns all cookies as a name→value map,
 *   or `null` if the header is absent.
 *
 * @property {function(): string|null} getAuthorizationBearer
 *   Extracts the Bearer token from the `Authorization` header per RFC 6750.
 *   Returns the token string without the `'Bearer '` prefix, or `null` if
 *   the header is absent or uses a different scheme.
 *
 * @property {function(): Promise<*>} json
 *   Reads and parses the request body as JSON. MUST reject with
 *   `BadRequestError` on parse failure so the error handler pipeline
 *   surfaces a 400 response automatically.
 *
 * @property {function(): Promise<FormData>} formData
 *   Reads and parses the request body as form data. Supports
 *   `application/x-www-form-urlencoded` and `multipart/form-data`, selected
 *   automatically from the `Content-Type` header. Rejects with `TypeError`
 *   when the content type is missing or unsupported.
 */
