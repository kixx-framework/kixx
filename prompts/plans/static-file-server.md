# Static File Server — Implementation Plan

## Implementation Approach

Add a cross-platform `StaticFileServerStore` following the same port/adapter shape
as the Logger, Key/Value, and Document stores: a JSDoc-only interface contract in
`src/kixx/static-file-server/`, plus a Node.js filesystem adapter and a Cloudflare
Workers Static Assets adapter under `src/plugins/`. The store's single read method
returns a standard Web `Response` (the portable floor: Cloudflare's
`env.ASSETS.fetch()` returns one directly, and Node builds one trivially) or `null`
when the file is absent; the store never depends on the router's `ServerResponse`.
A framework-level request handler in `src/kixx/static-file-server/` (mirroring
`src/kixx/hyperview/hyperview-request-handlers.js`) derives the relative file path
from a route wildcard param, calls the store, and maps the `Response` onto the
application `ServerResponse` via `respondWithStream`. The handler is wired into the
app through a new `/static/*filepath` route placed before the existing Hyperview
catch-all in `virtual-hosts.js`.

Cross-cutting decisions and scope:
- **Read-only.** No write methods on either adapter (writes are descoped; static
  files are deployed out-of-band).
- **v1 HTTP features:** full-body read with correct `Content-Type` and
  byte-accurate `Content-Length` only. No Range, conditional (`If-None-Match` /
  `If-Modified-Since`), or cache-control handling yet.
- **`null` on absence**, so the handler raises `NotFoundError` and the framework's
  normal 404 path renders — rather than leaking Cloudflare's asset-404 response.
- **URL prefix `/static/*filepath`** (configurable on the handler). Root-serving is
  not viable because the Hyperview catch-all matches first and routing does not fall
  through between routes on a handler 404.
- **Out of scope:** index/directory resolution (deferred to the routing layer),
  the Cloudflare Worker entry point and `wrangler` `assets` binding config (no
  Cloudflare entry exists in the repo yet — the adapter and plugin are still created
  for parity), and automated tests (can be written on request).

## TODO

- [x] **Define the StaticFileServerStore interface contract**
  - **Story**: Portable static file serving
  - **What**: Create a JSDoc-only interface module documenting the contract: a single
    `read(context, pathname): Promise<Response|null>` method that resolves to a Web
    `Response` (status, headers, body stream) or `null` when the file is absent.
    Document invariants: no write methods exist; `context` pass-through (Cloudflare
    resolves `context.env.ASSETS` per call, Node owns a long-lived root directory and
    ignores `context`); the returned `Response` carries `Content-Type` and a
    byte-accurate `Content-Length`; `pathname` is relative to the public root and
    must already be path-safety validated by the caller; adapters must still guard
    against traversal independently.
  - **Where**: `src/kixx/static-file-server/static-file-server-store-interface.js`
  - **Documentation**: `src/kixx/key-value-store/key-value-store-interface.js`, `src/kixx/document-store/document-store-engine-interface.js`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: Interface file exists, exports only typedefs/JSDoc (no runtime code), and fully states the read contract, the null-on-absence rule, the no-writes rule, and the context pass-through behavior.
  - **Depends on**: none

- [x] **Add a MIME type lookup for the Node adapter**
  - **Story**: Node.js static file serving
  - **What**: A small module mapping common file extensions to MIME types
    (`html`, `css`, `js`, `mjs`, `json`, `svg`, `png`, `jpg`/`jpeg`, `gif`, `webp`,
    `ico`, `woff2`, `txt`, `pdf`, `map`, …) with a `getContentType(pathname)` helper
    defaulting to `application/octet-stream`. Hand-rolled, no new dependency.
  - **Where**: `src/kixx/static-file-server/mime-types.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `src/docs/code-quality.md`
  - **Acceptance criteria**: `getContentType()` returns the correct type for known extensions and `application/octet-stream` for unknown/extensionless paths.
  - **Depends on**: none

- [x] **Add static-file pathname validation**
  - **Story**: Static file read endpoint
  - **What**: A path-safety validator for static file requests that rejects `..`,
    `//`, leading-dot path segments, and characters outside a safe set, throwing
    `BadRequestError`. Own copy for the static-file-server to avoid coupling to the
    Hyperview module; note the conscious duplication in a comment and that a future
    task may hoist a shared path-safety utility.
  - **Where**: `src/kixx/static-file-server/validate-pathname.js`
  - **Documentation**: `src/kixx/hyperview/validate-pathname.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: Valid nested paths (e.g. `css/main.css`) pass through unchanged; traversal and disallowed-character inputs throw `BadRequestError`.
  - **Depends on**: none

- [x] **Implement the Node.js StaticFileServerStore adapter**
  - **Story**: Node.js static file serving
  - **What**: Filesystem-backed adapter implementing the interface. `read()` resolves
    the requested pathname against the configured public root using
    `path.resolve` and verifies the resolved absolute path stays within the root
    (authoritative traversal guard, independent of any string validator); returns
    `null` when the target is missing, is a directory, or escapes the root. For a
    real file, `stat()` for byte size, detect `Content-Type` via the MIME helper,
    and return `new Response(Readable.toWeb(fs.createReadStream(absPath)), { status: 200, headers })`
    with `content-type` and byte-accurate `content-length` set. Constructor takes
    `{ logger, directory }` and creates a child logger; ignores `context`.
  - **Where**: `src/plugins/node-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: `src/kixx/static-file-server/static-file-server-store-interface.js`, `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js`, `src/plugins/node-key-value-store/lib/key-value-store.js`
  - **Acceptance criteria**: Reading an existing file resolves to a 200 `Response` with correct `Content-Type` and byte-accurate `Content-Length`; missing files, directories, and traversal attempts resolve to `null`.
  - **Depends on**: Define the StaticFileServerStore interface contract, Add a MIME type lookup for the Node adapter

- [x] **Implement the Cloudflare StaticFileServerStore adapter**
  - **Story**: Portable static file serving
  - **What**: Static Assets adapter implementing the interface. `read()` builds a
    synthetic `Request` whose URL pathname is the leading-slash relative pathname
    (e.g. `/css/main.css`), calls `context.env.ASSETS.fetch(request)`, returns `null`
    when the response status is `404`, and otherwise returns the `Response` as-is
    (Cloudflare already sets `Content-Type`/`Content-Length`). No write methods.
    Constructor takes `{ logger }` and creates a child logger; resolves the `ASSETS`
    binding from `context` per call.
  - **Where**: `src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: `src/kixx/static-file-server/static-file-server-store-interface.js`, `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`
  - **Acceptance criteria**: A present asset resolves to the Cloudflare `Response` unchanged; a missing asset (status 404 from `env.ASSETS`) resolves to `null`.
  - **Depends on**: Define the StaticFileServerStore interface contract

- [x] **Add the Node static-file-server plugin**
  - **Story**: Node.js static file serving
  - **What**: A `plugin.js` whose `register(context)` reads the public directory from
    `context.env.STATIC_FILE_STORE?.directory`, constructs the Node adapter with the
    root logger and directory, and registers it as the `'StaticFileServerStore'`
    service.
  - **Where**: `src/plugins/node-static-file-server/plugin.js`
  - **Documentation**: `src/plugins/node-hyperview-template-file-store/plugin.js`
  - **Acceptance criteria**: After registration, `context.getService('StaticFileServerStore')` returns the configured Node adapter.
  - **Depends on**: Implement the Node.js StaticFileServerStore adapter

- [x] **Add the Cloudflare static-file-server plugin**
  - **Story**: Portable static file serving
  - **What**: A `plugin.js` whose `register(context)` constructs the Cloudflare
    adapter with the root logger (no directory; the `ASSETS` binding is resolved per
    request) and registers it as the `'StaticFileServerStore'` service.
  - **Where**: `src/plugins/cloudflare-static-file-server/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-key-value-store/plugin.js`, `src/plugins/hyperview/plugin.js`
  - **Acceptance criteria**: After registration, `context.getService('StaticFileServerStore')` returns the Cloudflare adapter.
  - **Depends on**: Implement the Cloudflare StaticFileServerStore adapter

- [x] **Register the new plugins in the plugin aggregator**
  - **Story**: Portable static file serving
  - **What**: Import and add `nodeStaticFileServer` to `nodePlugins` and
    `cloudflareStaticFileServer` to `cloudflarePlugins` so the Node bootstrap (and a
    future Cloudflare bootstrap) register the service.
  - **Where**: `src/plugins/mod.js`
  - **Documentation**: `src/plugins/mod.js`, `src/node-server.js`
  - **Acceptance criteria**: Starting the Node server registers `'StaticFileServerStore'` with no errors.
  - **Depends on**: Add the Node static-file-server plugin, Add the Cloudflare static-file-server plugin

- [x] **Implement the static file read request handler factory**
  - **Story**: Static file read endpoint
  - **What**: A `StaticFileServerHandler(options)` factory (mirroring the Hyperview
    handler factories) returning an async `(context, request, response, skip)`
    handler. Read the route wildcard param (`options.pathnameParam`, default
    `'filepath'`) from `request.pathnameParams`, join its segments into a relative
    pathname, run `validatePathname`, then call
    `context.getService('StaticFileServerStore').read(context, pathname)`. On `null`,
    throw `NotFoundError`. Otherwise map the `Response` onto the `ServerResponse`:
    for GET, `response.respondWithStream(status, fileResponse.body, { contentType, contentLength })`
    using the `Response` headers; for HEAD, cancel the body stream and pass `null` as
    the body (headers only) to avoid leaking an open file handle. Call `skip()` so
    the Hyperview catch-all does not also run.
  - **Where**: `src/kixx/static-file-server/static-file-server-request-handlers.js`
  - **Documentation**: `src/kixx/hyperview/hyperview-request-handlers.js`, `src/kixx/http-router/server-response.js`, `src/app/presentation/README.md`, `src/docs/error-handling.md`
  - **Acceptance criteria**: A GET for an existing file streams it with correct `Content-Type`/`Content-Length`; a HEAD returns the same headers with no body; a missing file yields a `NotFoundError`; later middleware is skipped after a file is served.
  - **Depends on**: Define the StaticFileServerStore interface contract, Add static-file pathname validation

- [x] **Wire the static file route into virtual-hosts.js**
  - **Story**: Static file read endpoint
  - **What**: Add a `/static/*filepath` route (methods `GET`, `HEAD`) whose target
    uses `StaticFileServerHandler({ pathnameParam: 'filepath' })`, placed BEFORE the
    existing `*` Hyperview catch-all so it is matched first. Name the route and target
    consistently with existing entries (e.g. route `static-files`, target
    `serve-static-file`).
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/virtual-hosts.js`, `src/app/presentation/README.md` (route matching order and wildcard params)
  - **Acceptance criteria**: `GET /static/favicon.svg` serves `src/public/favicon.svg`; unknown `/static/...` paths return 404; non-`/static` paths still route to Hyperview.
  - **Depends on**: Implement the static file read request handler factory

- [x] **Add STATIC_FILE_STORE config for Node environments**
  - **Story**: Node.js static file serving
  - **What**: Add `"STATIC_FILE_STORE": { "directory": "./public" }` to each
    environment block (`development`, `staging`, `production`), mirroring the existing
    `TEMPLATE_FILE_STORE`/`PAGE_DATA_STORE` relative-directory convention.
  - **Where**: `src/node-config.json`
  - **Documentation**: `src/node-config.json`, `src/plugins/node-config/lib/config.js`
  - **Acceptance criteria**: The Node plugin reads a valid public directory in every environment and the server boots without a missing-config error.
  - **Depends on**: Add the Node static-file-server plugin

- [x] **Add required Web globals to the linter config (if flagged)**
  - **Story**: Portable static file serving
  - **What**: If `node run-linter.js` reports `no-undef` for `Response`, `Request`,
    `Headers`, `ReadableStream`, or `URL` in the new adapters/handler, add them to
    `languageOptions.globals` in `eslint.config.js` per the code style guide.
  - **Where**: `eslint.config.js`
  - **Documentation**: `src/docs/code-style-guide.md` (no-undef and Web Platform Globals)
  - **Acceptance criteria**: `node run-linter.js src/kixx/static-file-server src/plugins/node-static-file-server src/plugins/cloudflare-static-file-server` passes clean.
  - **Depends on**: Implement the Node.js StaticFileServerStore adapter, Implement the Cloudflare StaticFileServerStore adapter, Implement the static file read request handler factory
