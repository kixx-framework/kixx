/**
 * StaticFileStoreInterface — the contract for the static file store. The
 * implementation changes based on the platform (Node.js filesystem, Cloudflare
 * Workers KV, etc.) but the interface stays consistent so the framework request
 * handler remains runtime-agnostic.
 *
 * The store reads files that ship with a deployment and returns their bytes plus
 * the metadata the request handler needs to build an HTTP response. It is the
 * static-asset analogue of the key/value and document stores: a keyed lookup that
 * resolves to data or to `null` when the file is absent.
 *
 * ## Keyed, namespaced lookup
 * Files are addressed by a `key` within a `namespace`. The request handler derives
 * the `key` from the request URL pathname (query string and hash excluded) and the
 * `namespace` from the deployment Build ID (`context.runtime.build?.id`). The
 * namespace is what makes Atomic Deployments possible: each build's files live
 * under their own Build ID, so a new deployment swaps the whole asset set at once
 * without overwriting the previous build's files in place. When no Build ID is
 * present (for example, a Node.js deployment that copies files out-of-band with
 * rsync or git), `namespace` is `null` and the store reads from its un-namespaced
 * root.
 *
 * ## Return value: a parts object, not a Web `Response`
 * `read()` resolves to a {@link StaticFileResult} — the file body stream plus the
 * `contentType`, `contentLength`, and `etag` the handler needs — or to `null`. The
 * store deliberately does not build a Web `Response`: HTTP concerns (Cache-Control,
 * `If-None-Match` → 304 handling, HEAD, Content-Type overrides) belong to the
 * request handler, which assembles the application `ServerResponse` from these
 * parts. Keeping the store free of router types lets each platform adapter focus
 * only on locating bytes and metadata.
 *
 * ## ETag
 * `etag` MAY be `null`. Adapters whose backing store carries a precomputed etag
 * (the Cloudflare KV adapter reads one from KV metadata written by build tooling;
 * the Node.js adapter reads one from a per-build `manifest.json`) return it
 * directly and never hash at request time. When no precomputed etag exists and the
 * caller requests one via `options.computeEtag`, an adapter that can read the file
 * bytes (Node.js) computes a SHA-256 hash; otherwise `etag` is `null`. When
 * `options.computeEtag` is `false`, adapters MUST NOT compute an etag.
 *
 * ## Last-Modified
 * `lastModified` MAY be `null`. It is the second validator the request handler uses
 * for conditional requests: it populates the `Last-Modified` header and answers
 * `If-Modified-Since`. The Cloudflare adapter reads it from KV metadata; the Node.js
 * adapter prefers the per-build `manifest.json` value and falls back to the file
 * mtime. Preferring a build-tool-provided timestamp keeps `Last-Modified` identical
 * across replicas, since raw file mtimes diverge between servers after a checkout or
 * copy. Adapters return a `Date`, or `null` when no timestamp is available.
 *
 * ## Absence is `null`
 * When no file exists for `key` in `namespace`, `read()` resolves to `null`
 * (mirroring `KeyValueStore.get()` and `DocumentStore.get()`). The request handler
 * decides how to render the miss — throwing `NotFoundError` or deferring to the
 * next handler — rather than the store forwarding a platform-specific 404 body.
 *
 * ## Read-only
 * This store has no write methods. Static files are published by an out-of-band
 * deployment mechanism (Kixx build tooling or a manual copy), not at runtime. On
 * Cloudflare the backing KV values for a build are immutable for that build's
 * lifetime, so a runtime write method could not be implemented coherently; rather
 * than expose a method that throws on one platform, the contract omits writes.
 *
 * ## Path safety
 * `key` is the file path relative to the namespace root (for example
 * `css/main.css` or `favicon.svg`), without a leading prefix. The request handler
 * MUST run path-safety validation before calling `read()`. Adapters MUST
 * additionally guard against traversal on their own — the resolve-within-root check
 * on Node.js — so the store never serves a file outside its root even if a caller
 * forgets to validate.
 *
 * ## Context pass-through
 * `read()` receives a request or execution `context` as its first argument.
 * Runtime adapters use that context according to their platform:
 * - Cloudflare adapters resolve their request-scoped KV binding from
 *   `context.env` on every call.
 * - Node.js adapters resolve the local filesystem root from
 *   `context.config.env.STATIC_FILE_STORE` via `context.config.resolveFilepath()`
 *   on first use, unless an explicit constructor override was supplied, then
 *   hold it fixed for the store's lifetime.
 *
 * Implementations MUST accept the argument so callers can stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design, because their backing
 * stores and access models differ.
 * @see StaticFileStore in ../../plugins/node-static-file-server/lib/static-file-server-store.js for the Node.js filesystem implementation
 * @see StaticFileStore in ../../plugins/cloudflare-static-file-server/lib/static-file-server-store.js for the Cloudflare Workers KV implementation
 */

/**
 * The result of a successful static file read.
 *
 * @typedef {Object} StaticFileResult
 * @property {ReadableStream|null} body - Web `ReadableStream` of the file bytes, or
 *   `null` when only headers are needed. The body is single-use; a caller that does
 *   not stream it (a HEAD request or a 304 response) MUST cancel it to avoid
 *   leaking the underlying file handle or binding stream.
 * @property {string} contentType - The file's media type, used for the
 *   `Content-Type` header.
 * @property {number} contentLength - The file's exact byte length, used for the
 *   `Content-Length` header.
 * @property {string|null} etag - A strong validator for the file contents, used for
 *   the `ETag` header and `If-None-Match` revalidation, or `null` when no etag was
 *   computed or stored.
 * @property {Date|null} lastModified - The file's last-modified time, used for the
 *   `Last-Modified` header and `If-Modified-Since` revalidation, or `null` when
 *   unknown. The Node.js adapter takes it from the build manifest, falling back to
 *   the file mtime; the Cloudflare adapter takes it from KV metadata.
 */

/**
 * Static file store.
 *
 * @typedef {Object} StaticFileStoreInterface
 *
 * @property {function(Object, Object): Promise<(StaticFileResult|null)>} read
 *   Reads one file by `options.key` within `options.namespace`. The options object
 *   carries `{ key: string, namespace: (string|null), computeEtag: boolean }`.
 *   Resolves to a {@link StaticFileResult} when the file exists, or `null` when it
 *   does not. The `key` MUST be path-safety validated by the caller, and adapters
 *   MUST independently refuse to serve files outside their namespace root.
 */
