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
