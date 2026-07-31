# Publishing API v1

The Publishing API writes templates, page metadata, page includes, and static
assets into a Kixx build. This reference describes the HTTP contract for
developers implementing a client or SDK.

The API is write-only. Version 1 does not expose operations to read, list,
delete, or promote published resources. Published static assets are served
publicly at build-addressed URLs outside this API — see
[Reading a published asset](#reading-a-published-asset).

## Base path

All endpoints are relative to:

```text
/publishing-api/v1
```

Examples in this document use `https://example.com` as the deployment origin.

## Endpoint summary

| Method | Path | Request body | Build behavior |
|---|---|---|---|
| `PUT` | `/templates/base/{filepath}` | Base template source | Staged build only |
| `PUT` | `/templates/pages/{filepath}` | Page template source | Staged build only |
| `PUT` | `/templates/partials/{filepath}` | Partial template source | Staged build only |
| `PUT` | `/pages/{pathname}` | JSON:API page metadata | Named build or current build |
| `PUT` | `/pages` or `/pages/` | JSON:API root-page metadata | Named build or current build |
| `PUT` | `/includes/{filepath}` | Page include source | Named build or current build |
| `PUT` | `/assets/{filepath}` | Raw asset bytes | Staged build only, write-once |

Template, page metadata, and include writes use replacement semantics. Repeating
a successful request for the same resource and build replaces the previous value
and returns `200 OK`.

Static asset writes are write-once instead. The first successful `PUT` fixes the
bytes and stored media type at a given build ID and filepath. Repeating that
request unchanged returns `200 OK` without rewriting anything, while publishing
different content at the same address returns
`409 StaticAssetImmutableConflict`. See [Write-once addresses](#write-once-addresses).

## Authentication and authorization

Every request requires a Publishing API token as an HTTP Bearer token:

```http
Authorization: Bearer <publishing-api-token>
```

A missing, malformed, or unknown token returns `401`. An expired or revoked
token returns `403`. An active token without permission for the requested
operation also returns `403`.

Tokens are provisioned outside this API. The currently defined publishing
`Editor` role permits all endpoints. Authorization for page metadata and
includes is evaluated against the canonical pathname or filepath, while
template and asset permissions apply to the whole resource kind.

Treat tokens as secrets. A client should not log the `Authorization` header or
include it in error messages.

## Builds and atomic publishing

The optional or required build header is:

```http
Kixx-Build-Id: <build-id>
```

Header names are case-insensitive. A client should treat the *meaning* of a
build ID as opaque, but its form is not free-form: a build ID appears as a path
segment in public asset URLs and as a storage namespace, so it must satisfy the
format rules below.

The endpoints use two different build policies:

- Templates and assets require `Kixx-Build-Id`. The ID must not be the
  deployment's current build ID. These resources are staged for a later atomic
  deployment and cannot be edited in the live build.
- Page metadata and includes accept `Kixx-Build-Id` but do not require it. When
  it is omitted, the write targets the deployment's current build. If the
  deployment has no current build, the request fails with
  `409 CurrentBuildIdRequired`.
- An explicitly supplied build ID may target either a staged or current build
  for page metadata and includes.
- A deployment with no current build may still accept templates and assets for
  its first staged build.

The effective build ID is returned in every successful response.

### Build ID format

A build ID must be a single, safe URL path segment. It must:

- be a non-empty string;
- contain only the characters `A-Z a-z 0-9 _ . -`;
- contain no `/`, so a build ID is never more than one segment;
- not begin with `.`, and not contain `..`;
- not be exactly the lowercase value `dev`.

Build IDs are case-sensitive and are stored and echoed back exactly as supplied.
Only the exact lowercase `dev` is reserved; `DEV` is an ordinary valid build ID.
The reserved value names the flat, un-namespaced asset root used by deployments
that run without a build ID, so no build may publish into it.

| Status | Code | Condition |
|---|---|---|
| `400` | `ReservedBuildId` | Build ID is exactly `dev` |
| `400` | `InvalidBuildId` | Build ID is not one safe, non-empty path segment |

Every endpoint applies these rules, including those that do not require the
header. For page metadata and includes the rules are applied to the *effective*
build ID, so a supplied header is validated identically whether or not the
endpoint required one. A deployment's own current build ID is validated when the
server starts, so the omitted-header fallback cannot produce these errors
against a running deployment.

These checks run after the endpoint's existing requiredness check. A missing
header still reports `BuildIdRequired` on templates and assets, and still
reports `CurrentBuildIdRequired` on pages and includes when the deployment has
no current build.

### Live include visibility

Page metadata contains a required `version` used by live-build cache keys.
Include content is loaded through the owning page metadata, and an include is
only used when that metadata references it. When editing a live build, upload
the include and then replace the owning page metadata with a new `version`.
Uploading an include alone may leave the previously cached page content
visible.

## Path rules and canonicalization

Template filepaths, page pathnames, include filepaths, and asset filepaths may
contain nested path segments. After URL decoding, each segment may contain only:

```text
A-Z a-z 0-9 _ . -
```

The following are rejected:

- empty segments, including doubled slashes and trailing slashes on resources
  that require a filepath;
- `..` anywhere in the path;
- any segment beginning with `.`;
- whitespace, backslashes, query or fragment characters in a segment, and
  other characters outside the allowed set.

Use normal URL percent-encoding when constructing request URLs, but note that
percent-encoding does not make a disallowed decoded character valid.

Canonicalization differs by resource:

| Resource | Case behavior | Returned identifier |
|---|---|---|
| Templates | Folded to lowercase | Lowercase kind-relative filepath |
| Pages | Folded to lowercase | Lowercase pathname with leading `/` |
| Includes | Folded to lowercase | Lowercase filepath without leading `/` |
| Assets | Preserved exactly | Case-preserved filepath without leading `/` |

Clients should canonicalize template, page, and include identifiers before
caching them locally. Asset identifiers are case-sensitive and should be
preserved exactly.

## Media types and response format

Each endpoint has a specific request `Content-Type`, documented below. Media
type comparison is case-insensitive and ignores parameters. For example,
`Text/Plain; charset=utf-8` is treated as `text/plain`.

Successful responses and expected errors use JSON:API:

```http
Content-Type: application/vnd.api+json; charset=utf-8
```

Successful writes return a single resource document:

```json
{
  "data": {
    "type": "ResourceType",
    "id": "resource-id",
    "attributes": {}
  }
}
```

## Templates

### Put a base template

```http
PUT /publishing-api/v1/templates/base/{filepath}
```

### Put a page template

```http
PUT /publishing-api/v1/templates/pages/{filepath}
```

### Put a partial template

```http
PUT /publishing-api/v1/templates/partials/{filepath}
```

The three template endpoints have the same contract. The URL selects the
template kind.

### Request

Required headers:

```http
Authorization: Bearer <token>
Content-Type: text/plain
Kixx-Build-Id: <non-current-build-id>
```

The body is the template source as non-empty text.

Example:

```http
PUT /publishing-api/v1/templates/pages/blog/article.html HTTP/1.1
Host: example.com
Authorization: Bearer <token>
Content-Type: text/plain; charset=utf-8
Kixx-Build-Id: build-2026-07-29

<article>
    <h1>{{ page.title }}</h1>
    {{{ includes.body }}}
</article>
```

`filepath` is relative to the template kind selected by the endpoint. Do not
prefix the filepath with `base/`, `pages/`, or `partials/`.

The server folds every filepath segment to lowercase. Publishing
`Blog/Article.HTML` and `blog/article.html` addresses the same template.

### Response

Status: `200 OK`

```json
{
  "data": {
    "type": "Template",
    "id": "blog/article.html",
    "attributes": {
      "kind": "page",
      "filepath": "blog/article.html",
      "buildId": "build-2026-07-29"
    }
  }
}
```

`kind` is one of `base`, `page`, or `partial`.

### Template-specific errors

| Status | Code | Condition |
|---|---|---|
| `400` | `BuildIdRequired` | `Kixx-Build-Id` is missing or empty |
| `400` | `ReservedBuildId` | `Kixx-Build-Id` is the reserved value `dev` |
| `400` | `InvalidBuildId` | `Kixx-Build-Id` is not one safe path segment |
| `400` | `TemplateSourceRequired` | Body text is empty |
| `400` | `EmptyPathSegment` | Filepath contains an empty segment |
| `400` | `BAD_REQUEST_ERROR` | Filepath violates the path character or traversal rules |
| `409` | `CurrentBuildWriteConflict` | Build ID is the current build |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Media type is not `text/plain` |

## Page metadata

```http
PUT /publishing-api/v1/pages/{pathname}
```

Use either of the following paths for the site root:

```http
PUT /publishing-api/v1/pages
PUT /publishing-api/v1/pages/
```

Both root spellings address the same page and return `/` as the resource ID.
A trailing slash is not accepted after a non-root pathname.

### Request

Required headers:

```http
Authorization: Bearer <token>
Content-Type: application/vnd.api+json
```

Optional header:

```http
Kixx-Build-Id: <build-id>
```

The body must be a JSON:API document containing a `PageMetadata` resource:

```json
{
  "data": {
    "type": "PageMetadata",
    "attributes": {
      "version": "article-42-v3",
      "page": {
        "title": "An example article",
        "description": "An API publishing example."
      },
      "includes": {
        "body": {
          "filename": "body.md"
        }
      }
    }
  }
}
```

The resource `type` is case-sensitive and must be exactly `PageMetadata`.
`data.id` is not used to select the page; the URL pathname is authoritative.
SDKs should omit `data.id` from requests to avoid suggesting otherwise.

`attributes` is the complete page metadata document:

- `version` is required and must be a non-empty string.
- Additional attributes are accepted and preserved without schema projection.
- Replacing metadata replaces the full document; the server does not merge it
  with the previous value.
- When `includes` is present, it must be an object.
- Every `includes.<name>.filename` must be a valid, already-lowercase Hyperview
  identifier. Unlike URL pathnames, include filenames inside metadata are
  rejected rather than automatically folded to lowercase.

The server folds the URL pathname to lowercase and prefixes the returned
resource ID with `/`.

### Response

Status: `200 OK`

The submitted metadata bag is returned unchanged in `attributes`. The effective
build ID appears in resource-level `meta`, not in `attributes`.

```json
{
  "data": {
    "type": "PageMetadata",
    "id": "/blog/example-article",
    "attributes": {
      "version": "article-42-v3",
      "page": {
        "title": "An example article",
        "description": "An API publishing example."
      },
      "includes": {
        "body": {
          "filename": "body.md"
        }
      }
    },
    "meta": {
      "buildId": "build-2026-07-29"
    }
  }
}
```

### Page-metadata-specific errors

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST_ERROR` | Invalid JSON, malformed JSON:API envelope, or invalid pathname |
| `400` | `EmptyPathSegment` | Non-root pathname contains an empty segment |
| `400` | `ReservedBuildId` | `Kixx-Build-Id` is the reserved value `dev` |
| `400` | `InvalidBuildId` | `Kixx-Build-Id` is not one safe path segment |
| `400` | `InvalidPageIncludes` | `attributes.includes` is present but is not an object |
| `400` | `InvalidIncludeFilename` | An include filename is missing, invalid, or not lowercase |
| `409` | `JsonApiResourceTypeMismatch` | `data.type` is not `PageMetadata` |
| `409` | `CurrentBuildIdRequired` | Header is omitted and the deployment has no current build |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Media type is not `application/vnd.api+json` |
| `422` | `VALIDATION_ERROR` | `attributes.version` is missing, empty, or not a string |

## Page includes

```http
PUT /publishing-api/v1/includes/{filepath}
```

An include filepath combines the owning page pathname and the page-relative
filename. The last segment is the filename; all preceding segments identify the
page.

| Request filepath | Owning page pathname | Filename |
|---|---|---|
| `body.md` | `/` | `body.md` |
| `blog/article/body.md` | `/blog/article` | `body.md` |

### Request

Required headers:

```http
Authorization: Bearer <token>
Content-Type: text/*
```

Optional header:

```http
Kixx-Build-Id: <build-id>
```

The body is non-empty include source text. Any `text/*` media type is accepted,
including `text/plain`, `text/markdown`, and `text/html`.

Example:

```http
PUT /publishing-api/v1/includes/blog/example-article/body.md HTTP/1.1
Host: example.com
Authorization: Bearer <token>
Content-Type: text/markdown; charset=utf-8
Kixx-Build-Id: build-2026-07-29

# Example article

Published through the API.
```

The entire filepath is folded to lowercase. A separately published page
metadata document must reference the resulting filename for Hyperview to load
the include.

### Response

Status: `200 OK`

```json
{
  "data": {
    "type": "Include",
    "id": "blog/example-article/body.md",
    "attributes": {
      "pathname": "/blog/example-article",
      "filename": "body.md",
      "buildId": "build-2026-07-29"
    }
  }
}
```

### Include-specific errors

| Status | Code | Condition |
|---|---|---|
| `400` | `IncludeSourceRequired` | Body text is empty |
| `400` | `EmptyPathSegment` | Filepath contains an empty segment |
| `400` | `BAD_REQUEST_ERROR` | Filepath violates the path character or traversal rules |
| `400` | `ReservedBuildId` | `Kixx-Build-Id` is the reserved value `dev` |
| `400` | `InvalidBuildId` | `Kixx-Build-Id` is not one safe path segment |
| `409` | `CurrentBuildIdRequired` | Header is omitted and the deployment has no current build |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Media type does not begin with `text/` |

## Static assets

```http
PUT /publishing-api/v1/assets/{filepath}
```

### Request

Required headers:

```http
Authorization: Bearer <token>
Content-Type: <asset-media-type>
Kixx-Build-Id: <non-current-build-id>
```

The body contains the non-empty raw asset bytes. The maximum accepted body size
is 24 MiB (`25,165,824` bytes). A body of exactly 24 MiB is accepted.

The server does not infer the media type from the filename. It stores the
declared media type after lowercasing it and removing all parameters. For
example:

```text
Text/CSS; charset=utf-8 -> text/css
```

This means media type parameters such as `charset` do not survive publishing.

Unlike all other resource paths, asset filepath case is preserved. The later
public asset request must use the same casing.

### Response

Status: `200 OK`

```json
{
  "data": {
    "type": "StaticAsset",
    "id": "images/Logo.PNG",
    "attributes": {
      "filepath": "images/Logo.PNG",
      "buildId": "build-2026-07-29",
      "contentType": "image/png",
      "contentLength": 2841,
      "etag": "\"d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592\""
    }
  }
}
```

`contentLength` is the number of stored bytes. `etag` is a strong, quoted ETag
derived from the SHA-256 digest of those bytes. An identical retry returns this
same document describing the already-stored asset.

### Write-once addresses

A static asset address is the pair of build ID and filepath. The first
successful `PUT` fixes that address for the life of the build. A later `PUT` to
the same address is compared against the stored asset on three values:

- the strong ETag of the request body — the quoted SHA-256 digest of the bytes;
- the byte length of the request body;
- the normalized media type, lowercased and with parameters removed.

When all three match, the request is an identical retry: the API returns
`200 OK` with the stored asset's parts and does not rewrite it. This is what
makes replaying a request after a network failure safe.

When any of them differs — or the stored asset carries no strong ETag for the
server to compare against — the API returns `409 StaticAssetImmutableConflict`
and leaves the stored asset untouched. Changed output must be published under a
new build ID.

Immutability is a **sequential** guarantee only. The server reads the address
before writing, but performs no atomic create-only operation, so two concurrent
first writes to the same address can both observe an absent asset and race.
Clients must serialize writes to a single build ID and filepath. Concurrent
writes to *different* addresses are supported.

The comparison is reached only after every earlier check passes. A `PUT`
targeting the current build still returns `CurrentBuildWriteConflict` even when
its bytes match what is stored.

### Reading a published asset

Published assets are served outside the Publishing API at:

```http
GET /assets/{build-id}/{filepath}
```

`{filepath}` is exactly the filepath used to publish the asset. The published
filepath never includes the `/assets/` prefix or the build ID; the read URL adds
both:

```text
PUT /publishing-api/v1/assets/stylesheets/stylesheet.css
Kixx-Build-Id: build-2026-07-29

GET /assets/build-2026-07-29/stylesheets/stylesheet.css
```

The URL carries the build ID, so an asset staged for a build that has not been
promoted is publicly readable as soon as it is written, and an asset belonging
to a previous build stays readable while that build's files remain in the store.
Reads never consult the deployment's current build.

Responses use `Cache-Control: public, max-age=31536000, immutable` alongside
`ETag` and `Last-Modified` validators. That cache policy is the reason the write
path is write-once: a URL already handed to a browser or CDN must never change
its bytes.

The filepath is used exactly as published, including case. The reserved `dev`
segment (`GET /assets/dev/{filepath}`) reads the flat, un-namespaced root used
by deployments running without a build ID; it is not a build and cannot be
published to.

### Asset-specific errors

| Status | Code | Condition |
|---|---|---|
| `400` | `ContentTypeRequired` | `Content-Type` is missing or empty |
| `400` | `BuildIdRequired` | `Kixx-Build-Id` is missing or empty |
| `400` | `ReservedBuildId` | `Kixx-Build-Id` is the reserved value `dev` |
| `400` | `InvalidBuildId` | `Kixx-Build-Id` is not one safe path segment |
| `400` | `StaticAssetSourceRequired` | Body has zero bytes |
| `400` | `EmptyPathSegment` | Filepath contains an empty segment |
| `400` | `BAD_REQUEST_ERROR` | Filepath violates the path character or traversal rules |
| `409` | `CurrentBuildWriteConflict` | Build ID is the current build |
| `409` | `StaticAssetImmutableConflict` | Address already holds different bytes or a different content type |
| `413` | `PAYLOAD_TOO_LARGE_ERROR` | Body exceeds 24 MiB |

Asset checks run in a fixed order, so a request with more than one problem
reports the first one reached: filepath, `Content-Type`, body size, body bytes,
build ID presence, build ID format, current-build conflict, and finally the
write-once comparison.

## Error documents

Expected failures use a JSON:API error document:

```json
{
  "errors": [
    {
      "status": "400",
      "code": "BuildIdRequired",
      "title": "BadRequestError",
      "detail": "Kixx-Build-Id is required for template writes."
    }
  ]
}
```

Each error object has:

| Field | Type | Description |
|---|---|---|
| `status` | string | HTTP status code represented as a string |
| `code` | string | Stable machine-readable application code |
| `title` | string | Error class title |
| `detail` | string | Public human-readable explanation |
| `source` | string | Optional field or input location |

Validation can return more than one error object. For example, page metadata
validation identifies the affected field through `source`:

```json
{
  "errors": [
    {
      "status": "422",
      "code": "VALIDATION_ERROR",
      "title": "ValidationError",
      "detail": "Page metadata version is required",
      "source": "version"
    }
  ]
}
```

Common errors across the API are:

| Status | Code | Meaning |
|---|---|---|
| `400` | `BAD_REQUEST_ERROR` | Malformed request or invalid path |
| `401` | `UNAUTHENTICATED_ERROR` | Bearer token is missing, malformed, or unknown |
| `403` | `PublishingApiTokenInactive` | Token is expired or revoked |
| `403` | `PublishingApiTokenForbidden` | Token lacks permission for the operation or resource |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | Path exists but does not accept the request method |
| `409` | `CONFLICT_ERROR` or a specific code | Request conflicts with deployment or resource state |
| `413` | `PAYLOAD_TOO_LARGE_ERROR` | Request body is too large |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Request media type is unsupported |
| `422` | `VALIDATION_ERROR` | Request fields fail validation |

A `405` response includes an `Allow` header naming the supported method. All
currently documented Publishing API endpoints allow only `PUT`.

The JSON:API error contract applies after a documented Publishing API route has
matched. Deployments may handle an entirely unknown pathname through a
site-level catch-all, so SDKs should not assume that an unknown URL returns a
Publishing API JSON:API error.

Unexpected server failures are returned as generic internal-server errors.
Clients should branch on HTTP status and `errors[*].code`, not on `title` or
`detail`. Details are suitable for diagnostics but may become more specific
over time.

## SDK implementation recommendations

- Represent template, page/include, and asset publishing as separate operations
  so their build and case rules cannot be accidentally conflated.
- Require a build ID in the SDK method signature for templates and assets.
- Make the build ID optional for page metadata and includes, while clearly
  labeling omission as a live-build edit.
- Validate build IDs locally against the single-safe-segment rule, and reject
  `dev`, before sending a request. A generated build ID that fails these rules
  fails every publish in a deploy, so catching it once at the source is cheaper
  than reading `InvalidBuildId` off each response.
- Canonicalize template, page, and include paths to lowercase before using them
  as local cache keys. Do not lowercase asset paths.
- Serialize page metadata as JSON:API and omit request `data.id`; use the URL as
  the resource identity.
- Preserve response build IDs instead of assuming the requested ID, especially
  when a page or include request omitted the header.
- Model template, page metadata, and include operations as idempotent
  replacements, never as patches or creates.
- Model asset operations as idempotent write-once publishes. Serialize uploads
  to the same build ID and filepath, treat an identical retry as success, and
  treat `StaticAssetImmutableConflict` as a signal that the build ID must change
  rather than as a transient failure worth retrying.
- Parse JSON:API error arrays even when most failures contain only one error.
- Do not automatically retry `401`, `403`, `409`, `413`, `415`, or `422`
  responses. A retry requires changed credentials, request data, or build state.
