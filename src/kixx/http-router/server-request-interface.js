/**
 * ServerRequestInterface — the contract for the HTTP request object passed
 * through the Kixx router and middleware pipeline. The implementation will
 * change based on the platform (Node.js, Cloudflare, Deno, etc.) but the
 * interface should remain consistent.
 *
 * The HTTP router depends on this interface to resolve routes and stamp
 * hostname/pathname parameters onto the request before invoking middleware.
 * Middleware and request handlers (application presentation code) depend on
 * it for reading request data.
 *
 * Hostname and pathname patterns use path-to-regexp syntax: named parameters
 * are prefixed with a colon (`:id`) and wildcard parameters with an asterisk
 * (`*path`). See `lib/vendor/path-to-regexp/Readme.md`.
 *
 * ## Routing core vs application conveniences
 *
 * Only a small subset of this interface is load-bearing for the router itself.
 * An adapter MUST implement the routing core correctly for any request to be
 * dispatched. The remaining members are consumed only by middleware and request
 * handlers; an adapter SHOULD provide them for application code but the router
 * never reads them.
 *
 * Routing core (required by HttpRouter):
 * - `id` — stamped onto the router's `error` event for log correlation
 * - `method` — matched against each target's allowed HTTP methods (the
 *   uppercase invariant is load-bearing; a lowercase method silently fails to
 *   match and yields a 405)
 * - `url.hostname` and `url.pathname` — matched against virtual hosts and routes
 * - `setHostnameParams()` / `setPathnameParams()` — called (chained) before the
 *   middleware chain runs, so each MUST return `this`
 *
 * Application conveniences (consumed by middleware, never by the router):
 * `headers`, `body`, `queryParams`, `ifModifiedSince`, `ifNoneMatch`,
 * `isHeadRequest`, `isJSONRequest`, `isFormURLEncodedRequest`, `getCookie`,
 * `getCookies`, `getAuthorizationBearer`, `json`, `formData`.
 *
 * ## Invariants
 * - `id` MUST be immutable after construction; MUST be unique per request
 *   within a server lifetime
 * - `method` MUST be the HTTP method in UPPERCASE (e.g., 'GET', 'POST')
 * - `url` MUST be a fully parsed `URL` instance with `hostname`, `pathname`,
 *   and `searchParams` available
 * - `headers` MUST be a Web API `Headers` instance (case-insensitive access)
 * - `body` MUST be a Web API `ReadableStream` when the request has a body,
 *   or `null` for bodyless requests; a non-null stream can only be consumed
 *   once — adapters MUST NOT allow the stream to be read before middleware runs
 * - `hostnameParams` and `pathnameParams` MUST be empty immutable objects at
 *   construction; the router calls `setHostnameParams()` and
 *   `setPathnameParams()` before invoking the middleware chain. When no route
 *   matches, the router throws before stamping params, so an error handler
 *   running for that 404 observes the empty construction-time objects
 * - `setHostnameParams()` and `setPathnameParams()` MUST return `this` for
 *   chaining, and MUST stamp the params so that the object later exposed by
 *   `hostnameParams`/`pathnameParams` is effectively immutable from a caller's
 *   perspective: mutating that object — or any nested value, such as a wildcard
 *   array — MUST NOT be observable by other code and MUST NOT affect routing
 *   state. Deep-freezing a clone at stamp time is the recommended
 *   implementation; returning a fresh clone on every read is permitted but
 *   discouraged (it amplifies read cost and yields unstable object identity)
 * - `json()` MUST reject with `BadRequestError` when the body is not valid
 *   JSON (rather than a raw `SyntaxError`) so the error handler pipeline
 *   surfaces a 400 response automatically
 * - `formData()` MUST reject with `UnsupportedMediaTypeError` when
 *   `Content-Type` is missing or not supported, and MUST reject with
 *   `BadRequestError` when the body cannot be parsed as submitted form data
 *   so the error handler pipeline surfaces useful 415 or 400 responses
 * - `ifModifiedSince` MUST return `null` when the header is absent or
 *   contains an unparseable date
 * - `ifNoneMatch` MUST return `null` when the header is absent; MUST strip
 *   surrounding quotes from strong ETags (e.g., `"abc"` → `"abc"` without
 *   quotes); MUST return weak ETags (e.g., `W/"abc"`) as-is
 */

/**
 * HTTP request object for the Kixx router and middleware pipeline.
 *
 * @typedef {Object} ServerRequestInterface
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
 * @property {ReadableStream|null} body
 *   Web API `ReadableStream` for the request body, or `null` for bodyless
 *   requests. Non-null streams can only be consumed once.
 *
 * @property {Object<string, string|string[]>} hostnameParams
 *   Immutable object of parameters extracted from the matched hostname pattern.
 *   Empty object until the router calls `setHostnameParams()`. A named param
 *   (`:tenant`) yields a string; a wildcard param (`*labels`) yields an array
 *   of the matched hostname segments.
 *   Example: pattern `:tenant.example.com`, host `acme.example.com`
 *   → `{ tenant: 'acme' }`.
 *
 * @property {Object<string, string|string[]>} pathnameParams
 *   Immutable object of parameters extracted from the matched pathname pattern.
 *   Empty object until the router calls `setPathnameParams()`. A named param
 *   (`:id`) yields a string; a wildcard param (`*path`) yields an array of the
 *   matched path segments. This includes routes mounted with a `'*'` pattern,
 *   which the router compiles to a `*path` wildcard.
 *   Example: pattern `/users/:id`, path `/users/123` → `{ id: '123' }`.
 *   Example: pattern `/files/*path`, path `/files/a/b` → `{ path: ['a', 'b'] }`.
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
 *   the header is absent, malformed, or uses a different scheme.
 *
 * @property {function(): Promise<*>} json
 *   Reads and parses the request body as JSON. MUST reject with
 *   `BadRequestError` on parse failure so the error handler pipeline
 *   surfaces a 400 response automatically.
 *
 * @property {function(): Promise<FormData>} formData
 *   Reads and parses the request body as form data. Supports
 *   `application/x-www-form-urlencoded` and `multipart/form-data`, selected
 *   automatically from the `Content-Type` header. Rejects with
 *   `UnsupportedMediaTypeError` when the content type is missing or
 *   unsupported, and `BadRequestError` when the body cannot be parsed as form
 *   data.
 */
