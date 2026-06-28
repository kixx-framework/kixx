# Static File Server v2 — Implementation Plan

## Implementation Approach

This plan reworks the existing static file capability so it matches the documented
contract: a `StaticFileRequestHandler` that owns HTTP concerns (Content-Type,
Cache-Control, ETag/`If-None-Match` → 304, HEAD, not-found behavior) delegating to
a renamed `StaticFileStore` that returns a plain parts object
(`{ body, contentType, contentLength, etag }` or `null`) rather than a Web
`Response`. Files are addressed by `key` (the request pathname minus query/hash)
within a `namespace` (the deployment Build ID, `context.runtime.build?.id`) to
support Atomic Deployments. The Node adapter serves from `/public`, namespacing by
Build ID only when one is present, reading pre-computed etags/content-types from a
per-build `manifest.json` and falling back to on-the-fly SHA-256 hashing (cached)
when no manifest entry exists. The Cloudflare adapter is rebuilt on a dedicated KV
binding (not the shared `KeyValueStore` service), storing raw file bytes as the
value with `etag` and `contentType` in KV metadata written by build tooling, so the
Worker never hashes. Cross-cutting: a new `kixx/`-level SHA-256 helper, precedence
rules (`options.contentType` > store contentType > extension-derived;
`options.cacheControl` > default), and a doc/interface rewrite so the supplied
documentation becomes the source of truth.

## TODO

- [x] **Add a cross-platform SHA-256 hex helper in `kixx/`**
  - **Story**: Node.js on-the-fly ETag computation
  - **What**: A small module exporting an async function that hashes an
    `ArrayBuffer`/`Uint8Array` (and/or a string) to a lowercase hex SHA-256 digest
    using the Web `crypto.subtle` API so it runs on every target runtime. Mirror the
    existing `app/lib/crypto.js` implementation but place it in the framework layer
    so `kixx/static-file-server` code can depend on it without reaching into `app/`.
  - **Where**: `src/kixx/utils/crypto.js` (added `sha256Hex` alongside the existing `generateShortId`)
  - **Documentation**: `src/app/lib/crypto.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`
  - **Acceptance criteria**: Hashing known bytes returns the expected lowercase hex SHA-256 digest; the module uses only Web Platform APIs (no `node:crypto`).
  - **Depends on**: none

- [x] **Redesign the StaticFileStore interface contract**
  - **Story**: Portable static file serving
  - **What**: Rewrite the JSDoc-only interface to describe `StaticFileStore` with a
    single method `read(context, options): Promise<StaticFileResult|null>` where
    `options` carries `{ key, namespace, computeEtag }`. Define a
    `StaticFileResult` typedef: `{ body: ReadableStream|null, contentType: string,
    contentLength: number, etag: string|null }`. Document the keyed/namespaced lookup
    model (key = request pathname minus query/hash; namespace = Build ID), the
    `null`-on-absence rule, the read-only rule, that the store no longer returns or
    depends on a Web `Response`, that `etag` may be `null` (when `computeEtag` is
    false or no precomputed value exists and the adapter does not compute one), and
    the per-platform `context` usage. Remove the stale "returns Response" and
    "no conditional/cache-control" language.
  - **Where**: `src/kixx/static-file-server/static-file-server-store-interface.js`
  - **Documentation**: `src/kixx/key-value-store/key-value-store-interface.js`, `src/docs/code-documentation-guide.md`, the supplied feature documentation
  - **Acceptance criteria**: Interface file exports only typedefs/JSDoc; fully states the parts-object return shape, the keyed/namespaced lookup, the null-on-absence rule, the no-writes rule, the nullable-etag rule, and per-adapter `context` behavior.
  - **Depends on**: none

- [x] **Rebuild the Node.js StaticFileStore adapter**
  - **Story**: Node.js static file serving
  - **What**: Replace the current adapter so `read(context, { key, namespace,
    computeEtag })` returns a `StaticFileResult` or `null`. Resolve the on-disk path
    as `join(root, namespace, key)` when `namespace` is a non-empty string, else
    `join(root, key)`; keep the authoritative resolve-within-root traversal guard.
    Return `null` for missing paths (`ENOENT`/`ENOTDIR`), directories, and
    non-files. Content-Type precedence within the store: manifest `contentType` when
    present, else `getContentType(key)`. ETag: when a per-build manifest entry exists
    use its `etag`; else when `computeEtag` is true, read the file bytes, hash with
    the SHA-256 helper, and cache the result keyed by `namespace+key+mtimeMs+size`
    (immutable within a build); else leave `etag` null. Stream the body with
    `Readable.toWeb(createReadStream(...))`; set `contentLength` from `stat().size`.
    Rename the exported class to `StaticFileStore`.
  - **Where**: `src/plugins/node-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: `src/kixx/static-file-server/static-file-server-store-interface.js`, `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js`
  - **Acceptance criteria**: A flat (no-namespace) read returns a parts object with correct stream, content-type, and byte-accurate content-length; a namespaced read resolves under `<root>/<buildId>/`; manifest-backed reads return the precomputed etag without hashing; no-manifest reads compute and cache the etag once; `computeEtag:false` returns `etag:null` and never hashes; missing files, directories, and traversal attempts return `null`.
  - **Depends on**: Add a cross-platform SHA-256 hex helper in `kixx/`, Redesign the StaticFileStore interface contract, Add the Node per-build manifest reader

- [x] **Add the Node per-build manifest reader**
  - **Story**: Node.js static file serving
  - **What**: A helper the Node adapter uses to read and cache `manifest.json` for a
    namespace. The manifest maps `key → { etag, contentType }` and is written by
    Kixx build tooling at `<root>/<buildId>/manifest.json`. Read once per namespace,
    cache in memory (manifests are immutable within a build), and tolerate a missing
    manifest by returning an empty lookup (out-of-band deploys have none). Expose a
    `lookup(namespace, key)` returning `{ etag, contentType } | null`.
  - **Where**: `src/plugins/node-static-file-server/lib/manifest.js`
  - **Documentation**: `src/plugins/node-static-file-server/lib/static-file-server-store.js`, the supplied feature documentation (Atomic Deployments section)
  - **Acceptance criteria**: With a manifest present, `lookup()` returns the entry; with no manifest, `lookup()` returns `null` without throwing; the manifest file is read at most once per namespace.
  - **Depends on**: none

- [x] **Rebuild the Cloudflare StaticFileStore adapter**
  - **Story**: Portable static file serving
  - **What**: Replace the ASSETS-based adapter with one backed by a dedicated KV
    binding (resolved from `context.env` by a configured binding name, NOT the shared
    `KeyValueStore` service). `read(context, { key, namespace })` computes the KV key
    from `namespace` + `key`, calls `getWithMetadata(kvKey, { type: 'stream' /
    'arrayBuffer' })`, returns `null` when the value is absent, else returns a
    `StaticFileResult` whose `contentType` and `etag` come from KV metadata (written
    by build tooling) and whose `contentLength` comes from metadata or the byte
    length. No write methods; no request-time hashing; ignores `computeEtag` (etags
    are always precomputed here). Rename the exported class to `StaticFileStore`.
  - **Where**: `src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: `src/kixx/static-file-server/static-file-server-store-interface.js`, `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`, the supplied feature documentation (Cloudflare section)
  - **Acceptance criteria**: A present asset returns a parts object with metadata-sourced content-type and etag; a missing KV key returns `null`; the adapter reads from a dedicated binding name and never calls the shared `KeyValueStore` service.
  - **Depends on**: Redesign the StaticFileStore interface contract

- [x] **Rebuild the static file request handler factory**
  - **Story**: Static file read endpoint
  - **What**: Rename the factory to `StaticFileRequestHandler(options)` and implement
    the documented options: `contentType`, `cacheControl` (default
    `"public, max-age=0, must-revalidate"`), `computeEtag` (default `true`),
    `throwNotFound` (default `true`), `skipWhenFound` (default `false`), and
    `pathname` (override the URL pathname for every request). Derive `key` from the
    (possibly overridden) URL pathname minus leading slash, query, and hash;
    validate it; resolve `namespace = context.runtime.build?.id ?? null`; call
    `store.read(context, { key, namespace, computeEtag })`. On `null`: throw
    `NotFoundError` when `throwNotFound`, else return `response` to defer. On a hit:
    apply content-type precedence (`options.contentType` > result.contentType >
    already-resolved), set `Cache-Control` (`options.cacheControl` > default), set
    `ETag` when present; handle `If-None-Match` → 304 (no body; cancel the stream);
    handle HEAD (headers only; cancel the stream); otherwise stream the body with
    `respondWithStream`. Call `skip()` only when `skipWhenFound` is true.
  - **Where**: `src/kixx/static-file-server/static-file-server-request-handlers.js`
  - **Documentation**: `src/kixx/static-file-server/static-file-server-store-interface.js`, `src/kixx/http-router/server-response.js`, `src/app/presentation/README.md`, `src/docs/error-handling.md`, the supplied feature documentation
  - **Acceptance criteria**: A GET for an existing file streams it with correct Content-Type/Content-Length/Cache-Control/ETag; a matching `If-None-Match` yields 304 with no body and no leaked stream; a HEAD returns headers only; a miss throws `NotFoundError` by default and defers when `throwNotFound:false`; `skipWhenFound:true` stops later handlers while the default leaves them to run; `options.pathname` and `options.contentType` overrides take effect.
  - **Depends on**: Redesign the StaticFileStore interface contract

- [x] **Update the Node and Cloudflare plugins for the rename and dedicated binding**
  - **Story**: Portable static file serving
  - **What**: Register both adapters under the renamed service key `'StaticFileStore'`.
    Node plugin: continue reading the public directory from config and constructing
    the Node `StaticFileStore`. Cloudflare plugin: construct the Cloudflare
    `StaticFileStore` with the configured dedicated KV binding name (and logger);
    resolve the binding from `context.env` per request inside the adapter.
  - **Where**: `src/plugins/node-static-file-server/plugin.js`, `src/plugins/cloudflare-static-file-server/plugin.js`
  - **Documentation**: `src/plugins/node-hyperview-template-file-store/plugin.js`, `src/plugins/cloudflare-key-value-store/plugin.js`
  - **Acceptance criteria**: After registration, `context.getService('StaticFileStore')` returns the correct adapter on each platform; the Cloudflare plugin wires the dedicated binding name.
  - **Depends on**: Rebuild the Node.js StaticFileStore adapter, Rebuild the Cloudflare StaticFileStore adapter

- [x] **Rewire virtual-hosts.js for the renamed handler and catch-all options**
  - **Story**: Static file read endpoint
  - **What**: Update the import to `StaticFileRequestHandler`. In the catch-all `*`
    target, call `StaticFileRequestHandler({ throwNotFound: false, skipWhenFound:
    true })` before `HyperviewStaticPageHandler()` so misses fall through to Hyperview
    and hits stop the chain. Confirm any dedicated static routes (if added) rely on
    the default `throwNotFound: true` and have an HTML error handler available in the
    cascade to render the 404.
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (route matching order, error handler cascade), the supplied feature documentation
  - **Acceptance criteria**: Requests for existing public files are served and skip Hyperview; missing-file requests render the Hyperview 404 path; non-file paths still route to Hyperview.
  - **Depends on**: Rebuild the static file request handler factory, Update the Node and Cloudflare plugins for the rename and dedicated binding

- [x] **Add Cloudflare static-file KV binding config**
  - **Story**: Portable static file serving
  - **What**: Add the dedicated KV binding name to the Cloudflare configuration
    surface the plugin reads, keeping it distinct from the general-purpose
    `KeyValueStore` binding. (No Node config change beyond the existing
    `STATIC_FILE_STORE.directory`.)
  - **Where**: Cloudflare config source consumed by `src/plugins/cloudflare-static-file-server/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-key-value-store/plugin.js`, `src/node-config.json`
  - **Acceptance criteria**: The Cloudflare plugin resolves the dedicated binding name from config without colliding with the shared KV binding.
  - **Depends on**: Update the Node and Cloudflare plugins for the rename and dedicated binding
  - **Note**: No Cloudflare config/wrangler file exists in the repo yet, so there is
    no runtime config file to seed a value into. The criterion is met in code: the
    adapter's `DEFAULT_BINDING_NAME` is `STATIC_FILE_STORE` (distinct from the shared
    `KEY_VALUE_STORE`), and the plugin reads an optional `config.env.STATIC_FILE_STORE.bindingName`
    override. Seeding an actual binding value belongs with the (out-of-scope)
    Cloudflare bootstrap/wrangler config.

- [x] **Add required Web globals to the linter config (if flagged)**
  - **Story**: Portable static file serving
  - **What**: If `node run-linter.js` reports `no-undef` for `Request`, `Response`,
    `Headers`, `ReadableStream`, `URL`, or `crypto` in the new modules, add them to
    `languageOptions.globals` in `eslint.config.js` per the code style guide.
  - **Where**: `eslint.config.js`
  - **Documentation**: `src/docs/code-style-guide.md` (no-undef and Web Platform Globals)
  - **Acceptance criteria**: `node run-linter.js src/kixx/static-file-server src/plugins/node-static-file-server src/plugins/cloudflare-static-file-server src/kixx/utils` passes clean.
  - **Depends on**: Rebuild the Node.js StaticFileStore adapter, Rebuild the Cloudflare StaticFileStore adapter, Rebuild the static file request handler factory

- [x] **Refresh the feature documentation and interface JSDoc**
  - **Story**: Portable static file serving
  - **What**: Ensure the interface JSDoc and any in-repo references reflect the new
    parts-object contract, keyed/namespaced lookup, ETag/304/Cache-Control behavior,
    KV-backed Cloudflare store, and the `StaticFileRequestHandler` option set. Make
    the supplied "Serving Static Files" documentation the canonical reference.
  - **Where**: `src/kixx/static-file-server/static-file-server-store-interface.js`, relevant README/doc location for the feature
  - **Documentation**: the supplied feature documentation, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: No remaining references to `StaticFileServerHandler`/`StaticFileServerStore`, the ASSETS binding, or the "returns Response / no conditional handling" contract; docs match the shipped behavior.
  - **Depends on**: Rewire virtual-hosts.js for the renamed handler and catch-all options

## Out of Scope

- Kixx build/deploy tooling that writes the Node `manifest.json` and uploads
  Cloudflare KV values with `etag`/`contentType` metadata (separate effort; this
  plan defines the read-side contract the tooling must satisfy).
- Range requests and large-asset handling beyond the KV 25 MiB per-value limit.
- Automated tests (written on request, per project policy).
