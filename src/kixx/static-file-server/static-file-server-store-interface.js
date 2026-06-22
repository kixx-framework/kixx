/**
 * StaticFileServerStoreInterface — the contract for the static file server store.
 * The implementation changes based on the platform (Node.js filesystem, Cloudflare
 * Workers Static Assets, etc.) but the interface stays consistent so application
 * code and the framework request handler remain runtime-agnostic.
 *
 * The store reads files that ship with a deployment and serves them over HTTP. It
 * is the static-asset analogue of the key/value and document stores, but it speaks
 * HTTP rather than returning data: a static file server inherently owns
 * Content-Type detection, byte counting, and (on platforms that provide it)
 * conditional and range handling, so the natural return value is a Web `Response`.
 *
 * ## Read-only
 * This store has no write methods. Static files are published by an out-of-band
 * deployment mechanism, not at runtime. On Cloudflare the backing Static Assets are
 * immutable for the lifetime of a deployment, so a write method could never be
 * implemented there; rather than expose a method that throws on one platform, the
 * contract omits writes entirely.
 *
 * ## Return value: a Web `Response`
 * `read()` resolves to a standard Web `Response` (status, headers, and a body
 * stream) or to `null`. `Response` is the portable floor: Cloudflare's
 * `env.ASSETS.fetch()` returns one directly, and a Node.js adapter constructs one
 * from a file stream. Returning the platform-standard type keeps the store free of
 * any dependency on the application's router `ServerResponse`; mapping the
 * `Response` onto a `ServerResponse` is the presentation layer's responsibility.
 *
 * A returned `Response` MUST carry a `Content-Type` header and a byte-accurate
 * `Content-Length` header so callers can serve it without re-measuring the body.
 *
 * ## Absence is `null`, not a 404 Response
 * When no file exists at `pathname`, `read()` resolves to `null` (mirroring
 * `KeyValueStore.get()` and `DocumentStore.get()`). The caller decides how to
 * render the miss — typically by throwing `NotFoundError` so the framework's normal
 * 404 path runs — rather than forwarding a platform-specific 404 body.
 *
 * ## Pathname and path safety
 * `pathname` is the file path relative to the store's public root (for example
 * `css/main.css` or `favicon.svg`), without a leading prefix. Callers MUST run
 * path-safety validation before calling `read()`. Adapters MUST additionally guard
 * against traversal on their own — the resolve-within-root check on Node and the
 * binding's own path handling on Cloudflare — so the store never serves a file
 * outside its public root even if a caller forgets to validate.
 *
 * ## Scope (v1)
 * Full-body reads only: a correct `Content-Type` and byte-accurate
 * `Content-Length`. Range requests, conditional requests (`If-None-Match` /
 * `If-Modified-Since`), and cache-control negotiation are not part of this
 * contract yet. A platform that performs them internally (Cloudflare) MAY still do
 * so; the contract neither requires nor forbids it.
 *
 * ## Context pass-through
 * `read()` receives a request or execution `context` as its first argument. The
 * contract does not dictate how an implementation uses it: the Cloudflare adapter
 * resolves its Static Assets binding from `context.env.ASSETS` (a request-scoped
 * binding), while the Node.js adapter owns a long-lived root directory supplied at
 * construction and ignores `context` entirely. Implementations MUST accept the
 * argument regardless so callers can stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design, because their backing
 * stores and access models differ.
 * @see StaticFileServerStore in ../../plugins/node-static-file-server/lib/static-file-server-store.js for the Node.js filesystem implementation
 * @see StaticFileServerStore in ../../plugins/cloudflare-static-file-server/lib/static-file-server-store.js for the Cloudflare Workers Static Assets implementation
 */

/**
 * Static file server store.
 *
 * @typedef {Object} StaticFileServerStoreInterface
 *
 * @property {function(Object, string): Promise<(Response|null)>} read
 *   Reads one file by its public-root-relative `pathname`. Resolves to a Web
 *   `Response` carrying the file body, a `Content-Type` header, and a byte-accurate
 *   `Content-Length` header; resolves to `null` when no file exists at `pathname`.
 *   The `pathname` MUST be path-safety validated by the caller, and adapters MUST
 *   independently refuse to serve files outside their public root.
 */
