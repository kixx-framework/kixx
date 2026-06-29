# Publishing API: Static Asset Upload

## Implementation Approach

Add a deploy-time write path to the static file store so the Publishing API can
upload binary static assets (favicons, images, fonts, CSS) to a staged build,
mirroring the existing template/page/include upload endpoints. The work has three
layers: (1) a new `write()` method on the `StaticFileStoreInterface` contract and
both runtime adapters — Node writes the bytes to the Build-ID-namespaced
filesystem path and upserts a `manifest.json` entry (atomic temp-rename write
behind a per-namespace in-process lock); Cloudflare writes the bytes plus
`{ etag, contentType, contentLength, lastModified }` KV metadata; (2) the
presentation surface — a streaming, size-capped request-body buffer, a new
`PayloadTooLargeError` (413), a `putStaticAsset` transaction script, a raw-body
request handler, and a route in `virtual-hosts.js`; (3) doc updates.

Cross-cutting concerns:

- **Namespace = Build ID.** The write must encode `{namespace}/{key}` exactly as
  the read path decodes it, or published assets will not be found.
- **Staged-only builds** (per decision): asset writes require a `Kixx-Build-Id`
  that differs from the current build, reusing the template endpoint's
  `BuildIdRequired` / `CurrentBuildWriteConflict` semantics. Because a staged
  build is never the live namespace, the running server never serves from that
  namespace's manifest until a deploy promotes it (and restarts the process),
  which neutralizes `ManifestStore`'s process-lifetime cache staleness.
- **Manifest concurrency.** A maintained `manifest.json` is a shared index (unlike
  per-file template writes), so concurrent asset PUTs to the same staged build can
  lose updates. Mitigate with a per-namespace in-process async lock plus
  atomic temp-file-then-rename writes. Document the single-writer (one Node
  process) assumption.
- **Size cap.** Cloudflare KV values cap at 25 MiB, so the handler enforces a cap
  just under that and rejects oversized uploads with 413 before buffering the
  whole body.

Testing is intentionally out of scope here per project policy; once the code is in
place I can add unit/integration tests on request.

---

- [x] **Add `PayloadTooLargeError` (413) error class**
  - **Story**: Size-capped asset uploads
  - **What**: New HTTP error class modeled exactly on `BadRequestError` — `static CODE = 'PAYLOAD_TOO_LARGE_ERROR'`, `static HTTP_STATUS_CODE = 413`, default `expected = true`. Export it from the errors barrel. No JSON:API serializer change is needed: `jsonApiErrorHandler` already serializes any `httpError`/`expected` error from `error.httpStatusCode`.
  - **Where**: `src/kixx/errors/lib/payload-too-large-error.js` (new); `src/kixx/errors/mod.js` (add export)
  - **Documentation**: `src/docs/error-handling.md`; model on `src/kixx/errors/lib/bad-request-error.js`; `src/kixx/errors/lib/wrapped-error.js` (how `code`/`httpStatusCode`/`httpError`/`name` are derived)
  - **Acceptance criteria**: Throwing `PayloadTooLargeError` from a publishing handler yields a 413 JSON:API error document with `status: "413"`.
  - **Depends on**: none

- [x] **Add a streaming, size-capped request-body buffer helper**
  - **Story**: Static asset upload endpoint
  - **What**: `bufferRequestBodyWithLimit(request, maxBytes)` — fast-path reject when a `Content-Length` header already exceeds `maxBytes`; then read `request.body` (Web `ReadableStream`) chunk-by-chunk into a `Uint8Array`, throwing `PayloadTooLargeError` as soon as the accumulated size exceeds `maxBytes` (defense against a lying `Content-Length`); cancel the stream on abort. Return the assembled bytes. Let an empty body return zero-length bytes; the transaction script decides whether empty is an error.
  - **Where**: `src/app/presentation/lib/read-request-body.js` (new)
  - **Documentation**: `src/kixx/http-router/server-request-interface.js` (`body` is a one-shot `ReadableStream`); `src/docs/error-handling.md`
  - **Acceptance criteria**: Returns bytes for an in-limit body; throws `PayloadTooLargeError` for an over-limit body without buffering past the cap.
  - **Depends on**: Add `PayloadTooLargeError` (413) error class

- [x] **Extend the store interface contract with `write()`**
  - **Story**: Static file store write method
  - **What**: Revise the interface JSDoc: replace the "Read-only" rationale with a description of the single deploy-time write path (the Publishing API, analogous to the Hyperview service write path), and add a `write` member to the `@typedef StaticFileStoreInterface`. Contract: `write(context, { key, namespace, body, contentType })` where `body` is buffered bytes (`ArrayBuffer`/`Uint8Array`) and `contentType` may be empty/null. The store computes a strong `etag` (SHA-256), the exact `contentLength`, sets `lastModified` to write time, resolves `contentType` (argument, else extension via `getContentType(key)`), persists the validators alongside the bytes (Cloudflare KV metadata; Node `manifest.json` entry), and returns `{ key, contentType, contentLength, etag, lastModified }`. Document that enforcing "namespace is a staged, non-current build" is the caller's concern, and that adapters MUST apply the same traversal guard as `read()`.
  - **Where**: `src/kixx/static-file-server/static-file-server-store-interface.js`
  - **Documentation**: this file; `src/kixx/hyperview/template-file-store-interface.js` (parallel write contract)
  - **Acceptance criteria**: The contract documents the `write()` signature, return shape, metadata/etag ownership, and path-safety duties for both adapters.
  - **Depends on**: none

- [x] **Add manifest upsert to the Node `ManifestStore`**
  - **Story**: Maintain manifest.json on Node write
  - **What**: `upsertEntry(namespace, key, { etag, contentType, lastModified })` — serialize per-namespace with an in-process async lock; read the current raw manifest map (from cache when present, else disk via the existing read path, treating ENOENT as `{}`); merge the single entry; write atomically (write to a temp file in the same directory, then `rename`); update the cached map so a same-process `lookup()` observes the new entry. Add a short comment documenting the single-Node-process single-writer assumption (cross-process concurrent publishes to one server's disk can still race).
  - **Where**: `src/plugins/node-static-file-server/lib/manifest.js`
  - **Documentation**: `src/plugins/node-static-file-server/lib/manifest.js` (existing caching/contract comments); `src/kixx/static-file-server/README.md`
  - **Acceptance criteria**: Sequential and concurrent in-process upserts to the same namespace preserve all entries; a subsequent `lookup()` returns the upserted entry without a process restart.
  - **Depends on**: none

- [x] **Implement Node `StaticFileStore.write()`**
  - **Story**: Static file store write method
  - **What**: Add `write(context, { key, namespace, body, contentType })` to the Node store. Resolve the root directory (existing `#resolveRootDirectory`); compute the namespaced path the same way `read()` does (`path.join(root, namespace, key)` or flat root); apply the same resolve-within-root traversal guard and throw (not return null) on a write outside root; `mkdir -p` the parent; write the bytes. Compute `etag` with `sha256Hex` and `contentLength` from the byte length; resolve `contentType` (argument else `getContentType(key)`); set `lastModified = new Date()`. Write the bytes first, then `ManifestStore.upsertEntry(namespace, key, { etag, contentType, lastModified: lastModified.toISOString() })` so a manifest failure degrades to the read fallback rather than losing the asset. Return `{ key, contentType, contentLength, etag, lastModified }`.
  - **Where**: `src/plugins/node-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: the interface doc; the existing `read()`/`#resolveEtagAndBody` in the same file; `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js` (`#putFile` mkdir/write pattern)
  - **Acceptance criteria**: After `write()`, `read()` for the same `{ key, namespace }` returns the bytes with the manifest-provided `contentType`, strong `etag`, exact length, and the written `lastModified`.
  - **Depends on**: Extend the store interface contract with `write()`; Add manifest upsert to the Node `ManifestStore`

- [x] **Implement Cloudflare `StaticFileStore.write()`**
  - **Story**: Static file store write method
  - **What**: Add `write(context, { key, namespace, body, contentType })` to the Cloudflare store. Resolve the dedicated KV binding via the existing `#getKvStore`; build the namespaced `kvKey` the same way `read()` does (`{namespace}/{key}` or bare key). Compute `etag` (`sha256Hex`) and `contentLength`; resolve `contentType` (argument else `getContentType(key)`); set `lastModified = new Date()`. `await kvStore.put(kvKey, body, { metadata: { etag, contentType, contentLength, lastModified: lastModified.toISOString() } })`. Return `{ key, contentType, contentLength, etag, lastModified }`. Add a comment noting the 25 MiB KV value cap is enforced upstream by the request handler.
  - **Where**: `src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: the interface doc; the existing `read()` in the same file; `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js` (`#putFile` KV write pattern)
  - **Acceptance criteria**: After `write()`, `read()` for the same `{ key, namespace }` returns the bytes and the stored metadata (`etag`, `contentType`, `contentLength`, parsed `lastModified`).
  - **Depends on**: Extend the store interface contract with `write()`

- [x] **Add `putStaticAsset` transaction script**
  - **Story**: Static asset upload endpoint
  - **What**: `putStaticAsset(context, { filepath, body, contentType, buildId })`. Reject an empty body with `BadRequestError` (code `StaticAssetSourceRequired`). Enforce staged-build-only writes mirroring `putTemplate`: require `buildId` (`BadRequestError`, code `BuildIdRequired`) and reject `buildId === context.runtime.build?.id` (`ConflictError`, code `CurrentBuildWriteConflict`). Call `context.getService('StaticFileStore').write(context, { key: filepath, namespace: buildId, body, contentType })`; wrap unexpected store failures in `AssertionError` with `cause`. Return `{ filepath, buildId, contentType, contentLength, etag }` from the store result.
  - **Where**: `src/app/transaction-scripts/publishing/put-static-asset.js` (new)
  - **Documentation**: `src/app/transaction-scripts/README.md`; `src/app/transaction-scripts/publishing/put-template.js` (build-id enforcement pattern)
  - **Acceptance criteria**: Missing/current build id is rejected before any store write; a valid call returns the written asset's parts.
  - **Depends on**: Implement Node `StaticFileStore.write()`; Implement Cloudflare `StaticFileStore.write()`

- [x] **Add `putStaticAsset` request handler and export it**
  - **Story**: Static asset upload endpoint
  - **What**: Handler that (1) extracts and path-safety-validates the wildcard `*filepath` via `validatePathname`, throwing `BadRequestError` (code `StaticAssetFilepathRequired`) when empty; (2) asserts the publishing permission `action: 'urn:kixx:publishing:asset:put'`, `resource: 'urn:kixx:publishing:asset'` (coarse, like templates) before reading the body; (3) reads the `Kixx-Build-Id` header (`BUILD_ID_HEADER`); (4) requires a request `Content-Type` — read `request.getContentMediaType()` and throw `BadRequestError` (400, code `ContentTypeRequired`) when it is empty; any non-empty media type is accepted and stored as the served content type; (5) buffers the body with `bufferRequestBodyWithLimit(request, MAX_ASSET_BYTES)` where `MAX_ASSET_BYTES` is a module constant just under 25 MiB; (6) calls `putStaticAsset`; (7) responds `200` with a JSON:API `StaticAsset` resource (`id: filepath`, attributes `{ filepath, buildId, contentType, contentLength, etag }`), returning normally so route outbound middleware still runs. Re-export from the publishing-api `mod.js`.
  - **Where**: `src/app/presentation/request-handlers/publishing-api/put-static-asset.js` (new); `src/app/presentation/request-handlers/publishing-api/mod.js`
  - **Documentation**: `src/app/presentation/README.md`; `src/app/presentation/request-handlers/publishing-api/put-page-include.js` (wildcard split, permission, JSON:API response); `src/app/lib/publishing-permissions.js` (URN grammar)
  - **Acceptance criteria**: `PUT /assets/...` end-to-end works; over-cap → 413; bad path → 400; missing/inactive token → 401/403; insufficient grant → 403.
  - **Depends on**: Add a streaming, size-capped request-body buffer helper; Add `putStaticAsset` transaction script
  - **Notes**: `MAX_ASSET_BYTES` is a constant for now; a follow-up could source it from `config.env.STATIC_FILE_STORE` if a configurable cap is wanted.

- [x] **Wire the `/assets/*filepath` route in `virtual-hosts.js`**
  - **Story**: Static asset upload endpoint
  - **What**: Add a route under the existing `publishing-api` (`/publishing-api/v1`) route's `routes` array: `{ pattern: '/assets/*filepath', name: 'assets', targets: [{ name: 'put', methods: [ 'PUT' ], requestHandlers: [ PublishingAPI.putStaticAsset ] }] }`. It inherits `authenticatePublishingToken` inbound middleware and `jsonApiErrorHandler`. The prefix is distinct from the sibling routes, so ordering does not shadow anything.
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (routing, route matching order)
  - **Acceptance criteria**: `PUT /publishing-api/v1/assets/css/main.css` dispatches to the handler; a non-PUT method on that path returns 405 with an `Allow` header.
  - **Depends on**: Add `putStaticAsset` request handler and export it

- [x] **Update static-file-server documentation for the write path**
  - **Story**: All
  - **What**: In `src/kixx/static-file-server/README.md`, document the new deploy-time write path: that the Publishing API is the writer, the staged-build-only constraint, that Cloudflare stores validators as KV metadata while Node maintains a `manifest.json` entry per upload, and the single-Node-process single-writer assumption for manifest maintenance. Confirm the interface "Read-only" framing is updated (covered when extending the interface contract).
  - **Where**: `src/kixx/static-file-server/README.md`
  - **Documentation**: n/a
  - **Acceptance criteria**: README describes the upload path, per-runtime metadata behavior, and the staged-build constraint.
  - **Depends on**: Wire the `/assets/*filepath` route in `virtual-hosts.js`
