# Static Assets

`StaticAssetRequestHandler()` serves blobs published in the content-addressable store. It has two lookup modes selected by `fingerprinted`.

- Fingerprinted mode handles `/assets/:hash/*pathname`. It reads the blob by `hash`, returns `Cache-Control: public, max-age=31536000, immutable`, and uses that hash as the quoted `ETag`. A matching `If-None-Match` returns 304 before any store read.
- Pathname mode resolves the requested pathname through the current build's snapshot. It returns `Cache-Control: public, max-age=0, must-revalidate` and can defer a miss to the next handler in a catch-all route.

Both modes infer `Content-Type` from the logical pathname extension unless `contentType` overrides it. Fingerprinted responses omit `Content-Length`: a direct blob read has no index entry from which to obtain a size. Pathname responses use their index entry's size. Neither mode emits `Last-Modified` or uses `If-Modified-Since`; the content hash is always a strong validator.

```js
StaticAssetRequestHandler({
    fingerprinted: true,
});

StaticAssetRequestHandler({
    throwNotFound: false,
    skipWhenFound: true,
});
```

Options are `fingerprinted`, `cacheControl`, `contentType`, `throwNotFound`, and `skipWhenFound`. `throwNotFound` and `skipWhenFound` matter primarily in pathname mode. Fingerprinted route input is machine-minted and malformed input returns 400; a missing blob returns 404.

Hash-addressed reads deliberately bypass the snapshot index. Production adapters key this read by hash alone, so the hash is a bearer capability and the pathname is not access control.

## Development browser assets

Developer mode scans `src/static-assets/` into the current content snapshot.
Browser sources live in `src/static-assets/stylesheets/` and
`src/static-assets/javascript/`, while their public logical pathnames remain
`/stylesheets/**` and `/javascript/**`.

`assetUrl` gives template-linked entrypoints their own fingerprinted URL and
immutable cache policy. An entrypoint must import dependencies through a
root-relative logical pathname, such as `/stylesheets/lib/layout.css` or
`/javascript/lib/kquery.js`, rather than a relative URL. A relative import
would inherit the entrypoint hash, but hash-addressed storage reads key on that
hash alone and would return the entrypoint blob for a dependency request.

These pathname-mode dependencies resolve from the current snapshot and
revalidate independently. Editing an asset changes its developer content hash
on the next scan without an asset build or devserver restart. This only enables
development use of the content-addressable store: production build and
publishing tooling is not available yet.
