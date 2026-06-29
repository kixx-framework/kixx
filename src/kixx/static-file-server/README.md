# Serving Static Files

Use the `StaticFileRequestHandler` handler to serve static files from your request routing configuration. In `virtual-hosts.js`:

```js
import { StaticFileRequestHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';

export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
            {
                pattern: '/favicon.ico',
                name: 'favicon-ico',
                targets: [
                    {
                        name: 'serve',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticFileRequestHandler(),
                        ],
                    },
                ],
            },
        ],
    },
];
```

The `StaticFileRequestHandler` factory accepts an options object as the single parameter:

- `options.contentType` - Explicitly set the Content-Type header for the response. By default the Content-Type header is derived from the file extension. An explicit value takes precedence over both the store's value and extension detection.
- `options.cacheControl` - Explicitly set the Cache-Control header for the response. By default the Cache-Control header is set to "public, max-age=0, must-revalidate" which tells the browser that the asset can be cached, but that the browser should revalidate the freshness of the content every time before using it.
- `options.computeEtag` - The Etag header is computed as a hash of the file contents. If set to false, the Etag header will not be computed for this file. The `computeEtag` flag is `true` by default so browsers can use this in subsequent requests with an If-None-Match header to check for freshness, without needing to re-download the entire file in the case of a match. When the store already carries a precomputed Etag (see Atomic Deployments below), that value is used and nothing is hashed at request time.
- `options.throwNotFound` - When this flag is `true` the handler will throw a `NotFoundError` when the file does not exist, which will result in a 404 response being sent from the error handler. This is `true` by default. Set it to `false` when you want subsequent request handlers to handle the request when a file is not found.
- `options.skipWhenFound` - When this flag is `true` the handler will skip remaining request handlers on this route if the static file is found. This is `false` by default.
- `options.pathname` - Override the URL pathname for every request to the handler. This can be useful to rewrite certain URL pathnames before attempting to read the file from the store.

Here is another example of serving a file with customized options. In `virtual-hosts.js`:

```js
import { StaticFileRequestHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';

export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
            {
                pattern: '/css/images/*pathname',
                name: 'css-images',
                targets: [
                    {
                        name: 'serve',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticFileRequestHandler({
                                cacheControl: 'public, max-age=86400'
                            }),
                        ],
                    },
                ],
            },
        ],
    },
];
```

The `StaticFileRequestHandler` works well when used in the catch-all route with `throwNotFound` set to `false` and `skipWhenFound` set to `true`. In `virtual-hosts.js`:

```js
import { StaticFileRequestHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';

export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
            {
                pattern: '*',
                name: 'hyperview-static-catch-all',
                targets: [
                    {
                        // Catch-all renderer for static Hyperview static pages, including the
                        // site root, with optional JSON page data responses.
                        name: 'render-static-page',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticFileRequestHandler({
                                throwNotFound: false,
                                skipWhenFound: true,
                            }),
                            HyperviewStaticPageHandler(),
                        ],
                    },
                ],
            },
        ],
    },
];
```

## How Static File Serving Works

The `StaticFileRequestHandler` delegates to an internal Kixx component called the `StaticFileStore` which stores files by key. The `StaticFileRequestHandler` uses the request pathname, excluding query parameters and hashes, as the file key along with the current Build ID as the namespace to support Atomic Deployments. The `StaticFileStore` then looks up the file by key and namespace and returns a result.

The result carries the file body plus two cache validators — an ETag and a last-modified timestamp. The handler sends both as `ETag` and `Last-Modified` response headers and uses them to answer conditional requests with `304 Not Modified`: `If-None-Match` (ETag) is checked first and, when it is absent, `If-Modified-Since` (last-modified) is checked, matching the HTTP precedence rules.

There is an implementation of the `StaticFileStore` interface for each supported runtime.

### Under the Hood: Node.js StaticFileStore

When using the Node.js platform the StaticFileStore simply serves files from the project `/public` directory. If your project is using Atomic Deployments with a Build ID, then static files will be namespaced by the Build ID under the `/public` directory on your remote server when the Kixx deployment tooling uploads them.

### Under the Hood: Cloudflare Workers StaticFileStore

For Cloudflare Workers the StaticFileStore is backed by the KV Store. Files are cached in the KV Store indefinitely. When a new build is deployed the application will begin using the newly deployed static files from the KV Store under the latest Build ID value as a namespace.

The Cloudflare store reads from a dedicated KV binding (separate from the application's general-purpose key/value cache). Each file's raw bytes are stored as the KV value, with `{ etag, contentType, contentLength, lastModified }` stored as KV metadata by the deployment tooling, so the Worker never reads or hashes a file to produce a validator (`lastModified` is an ISO date string). Cloudflare KV values are capped at 25 MiB, which bounds the per-asset size this store can serve.

When deploying to Cloudflare, Kixx will always use Atomic Deployments with a Build ID.

## Deploy-Time Write Path (Publishing API)

In addition to the read path above, the `StaticFileStore` has a single deploy-time write method, `write()`, which allows writing binary static assets (favicons, images, fonts, CSS) to a build.

### Staged-build-only writes

Asset writes must target a **staged** build: the request's `Kixx-Build-Id` is required and must differ from the current (live) build. This keeps the live asset set immutable until an atomic promotion, and it means the running server never serves a written namespace's assets until a later deploy promotes that build and restarts the process — which is why the Node read-time metadata cache (each asset's sidecar read once and held for the process lifetime) stays correct alongside the write path. Hot-patching a single live asset is intentionally not supported.

### Server-computed validators

The store is the source of truth for cache validators. Given the buffered bytes plus an optional content type, `write()` computes a strong `ETag`, the exact `Content-Length`, a write-time `Last-Modified`, and resolves the `Content-Type` (the supplied value, else extension detection). The ETag is always computed server-side rather than trusted from the client, guaranteeing it matches the stored bytes.

### Per-runtime metadata behavior

- **Cloudflare:** writes the bytes plus `{ etag, contentType, contentLength, lastModified }` as KV metadata under `{buildId}/{key}` in the dedicated static-file KV binding, in a single `put`. The 25 MiB KV value cap bounds asset size; the request handler rejects an oversized upload with `413 PayloadTooLargeError` before buffering the whole body.
- **Node.js:** writes the bytes to the Build-ID-namespaced filesystem path, then writes a per-asset metadata sidecar (`{ etag, contentType, lastModified }`) under a reserved `.meta/` subtree that mirrors the asset key, so reads serve replica-stable validators without re-hashing. The bytes are written before the sidecar, so a metadata failure degrades to the read-time fallback (on-the-fly hashing, extension content type, file mtime) rather than losing the asset.

### Per-asset metadata sidecars (Node.js)

The Node store records each asset's validators in its own JSON sidecar under a reserved `.meta/` subtree that mirrors the asset key (`<buildId>/.meta/css/main.css.json` for asset `css/main.css`). Because every asset owns a separate file, there is no shared index to serialize: concurrent asset PUTs to the same staged build write disjoint sidecars, and two writers of the same asset write byte-identical validators (the ETag is derived from the content), so a last-writer-wins atomic rename is safe. Each sidecar is written atomically (temp file + `rename`), and the `.meta/` subtree is kept out of the servable key space so sidecars are never served as assets.
