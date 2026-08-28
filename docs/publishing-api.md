# Publishing API v1

The Publishing API lets a bearer-token client inspect the published content
snapshot, upload content-addressed resources, and publish a new content tree
for a build.

The API is mounted at:

```text
/publishing-api/v1
```

Examples in this document use `http://localhost:2026`, the default development
server origin.

## Endpoint summary

| Method | Path | Required permission | Purpose |
| --- | --- | --- | --- |
| `GET`, `HEAD` | `/index/static-asset/*path` | `urn:kixx:get` on `urn:kixx:publishing:stats:files` | Get a static asset's published reference |
| `GET`, `HEAD` | `/index/global-template-partials` | `urn:kixx:get` on `urn:kixx:publishing:stats:templates` | Get the published global-partials reference |
| `GET`, `HEAD` | `/index/base-templates` | `urn:kixx:get` on `urn:kixx:publishing:stats:templates` | Get the published base-templates reference |
| `GET`, `HEAD` | `/index/page-metadata{/*path}` | `urn:kixx:get` on `urn:kixx:publishing:stats:page` | Get a page metadata reference |
| `GET`, `HEAD` | `/index/page-partials{/*path}` | `urn:kixx:get` on `urn:kixx:publishing:stats:page` | Get a page partials reference |
| `GET`, `HEAD` | `/index/page-includes{/*path}` | `urn:kixx:get` on `urn:kixx:publishing:stats:page` | Get a page includes reference |
| `GET`, `HEAD` | `/index/page-templates/*path` | `urn:kixx:get` on `urn:kixx:publishing:stats:page` | Get a page template reference |
| `GET`, `HEAD` | `/index/emails/*path` | `urn:kixx:get` on `urn:kixx:publishing:stats:email` | Get an email-assets reference |
| `PUT` | `/resources/static-asset/*path` | `urn:kixx:create` on `urn:kixx:publishing:resources:files` | Upload a static asset |
| `PUT` | `/resources/global-template-partials` | `urn:kixx:create` on `urn:kixx:publishing:resources:templates` | Upload global partials |
| `PUT` | `/resources/base-templates` | `urn:kixx:create` on `urn:kixx:publishing:resources:templates` | Upload base templates |
| `PUT` | `/resources/page-metadata{/*path}` | `urn:kixx:create` on `urn:kixx:publishing:resources:page` | Upload page metadata |
| `PUT` | `/resources/page-partials{/*path}` | `urn:kixx:create` on `urn:kixx:publishing:resources:page` | Upload page partials |
| `PUT` | `/resources/page-includes{/*path}` | `urn:kixx:create` on `urn:kixx:publishing:resources:page` | Upload page includes |
| `PUT` | `/resources/page-templates/*path` | `urn:kixx:create` on `urn:kixx:publishing:resources:page` | Upload a page template |
| `PUT` | `/resources/emails/*path` | `urn:kixx:create` on `urn:kixx:publishing:resources:email` | Upload email assets |
| `PUT` | `/index/closure` | `urn:kixx:create` on `urn:kixx:publishing:index` | Publish a content tree for a build |

`*path` is a slash-separated content pathname. Page metadata, partials, and
includes allow an omitted path: `/page-metadata/`, `/page-partials/`, and
`/page-includes/` address the root page. The remaining path endpoints require
at least one segment. Every endpoint accepts an optional trailing slash.

Only the methods shown are allowed. A different method on a recognized path
returns `405 Method Not Allowed` with an `Allow` header.

## Authentication and authorization

Every request requires a Publishing API bearer token:

```http
Authorization: Bearer <publishing-token>
```

Create a token through the [Admin API](admin-api.md#create-a-publishing-api-token).
Missing, malformed, or unknown bearer credentials return `401` with code
`UNAUTHENTICATED_ERROR`. Expired and revoked tokens return `403` with code
`PublishingApiTokenInactive`.

Permissions are derived from the token's stored roles for every request. The
`editor` role can use every endpoint in this API; `root-admin`, `developer`,
and `admin` have the same publishing permissions. Unknown stored role IDs grant
no permissions. An authenticated token without the required grant receives
`403 FORBIDDEN_ERROR`.

Authentication and authorization occur before an endpoint reads or validates a
request body.

## Protocol conventions

### JSON:API documents

All successful responses are JSON:API documents with:

```http
Content-Type: application/vnd.api+json; charset=utf-8
```

The JSON write endpoints and closure endpoint require:

```http
Content-Type: application/vnd.api+json
```

Media-type parameters such as `charset=utf-8` are accepted. A missing or
different media type returns `415 Unsupported Media Type`.

Those write endpoints accept one resource document:

```json
{
    "data": {
        "type": "ResourceType",
        "attributes": {}
    }
}
```

`data` and `data.attributes` must be objects, and `data.type` must be a
non-empty string. A malformed document returns `400 Bad Request`; an incorrect
resource type returns `409 Conflict` with code `JsonApiResourceTypeMismatch`.
Request resource IDs are ignored.

Static assets are the exception: their request body is raw, non-empty bytes and
has no required media type. Page templates use a raw `text/plain` body.

### Responses

Resource uploads return `201 Created`. Their `data.id` and `attributes.hash`
are the blob hash, and `size` is its byte size:

```json
{
    "data": {
        "type": "PageTemplate",
        "id": "<blob-hash>",
        "attributes": {
            "pathname": "about/page.html",
            "hash": "<blob-hash>",
            "size": 28
        }
    }
}
```

Stat endpoints return `200 OK` with the same fields plus `metadata`, when the
published resource exists. Resources without a logical pathname omit
`pathname`. `HEAD` has the same status and headers as `GET`, without a body.
An absent published resource returns `404 NOT_FOUND_ERROR`.

### Error documents

Expected errors use JSON:API error documents. Error `status` values are
strings; validation errors can contain more than one error object.

```json
{
    "errors": [
        {
            "status": "422",
            "code": "VALIDATION_ERROR",
            "title": "ValidationError",
            "detail": "A template must have an id string",
            "source": "attributes.bundle.0"
        }
    ]
}
```

Common failures are:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `BAD_REQUEST_ERROR` | Malformed JSON:API request or an empty static-asset body |
| `401` | `UNAUTHENTICATED_ERROR` | Bearer credentials are absent, malformed, or unknown |
| `403` | `FORBIDDEN_ERROR` | The token lacks the endpoint permission |
| `403` | `PublishingApiTokenInactive` | The token is expired or revoked |
| `404` | `NOT_FOUND_ERROR` | The requested published resource does not exist |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | The method is not allowed on the recognized path |
| `409` | `JsonApiResourceTypeMismatch` | Request resource type is wrong |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | The request media type is not accepted |
| `422` | `VALIDATION_ERROR` | A resource or content-tree value is invalid |

Unexpected storage failures are not part of the public contract and are
reported as server failures without exposing internal details.

## Read published resource references

```http
GET /publishing-api/v1/index/page-templates/about/page.html
```

The `/index` endpoints read the build's current published snapshot. They do
not read uncommitted uploads. Each response identifies content by its immutable
hash, so a client can compare it with a local upload before constructing a
closure.

For endpoints with a logical pathname, the normalized pathname appears in the
response. The API normalizes route paths by collapsing repeated or outer slashes
and lowercasing them; only safe, canonical content paths can ultimately be
published.

```json
{
    "data": {
        "type": "PageTemplate",
        "id": "<blob-hash>",
        "attributes": {
            "pathname": "about/page.html",
            "hash": "<blob-hash>",
            "size": 28,
            "metadata": null
        }
    }
}
```

Example:

```bash
curl --header 'Authorization: Bearer kxpat_<secret>' \
    http://localhost:2026/publishing-api/v1/index/page-templates/about/page.html
```

## Upload resources

Uploads write an immutable content blob but do not make it part of a build.
Use the returned `{hash, size}` reference in a later content-tree closure.

### Static assets

```http
PUT /publishing-api/v1/resources/static-asset/css/site.css
```

Send raw, non-empty bytes. The API accepts any media type for this body.

```bash
curl --request PUT \
    --header 'Authorization: Bearer kxpat_<secret>' \
    --data-binary '@site.css' \
    http://localhost:2026/publishing-api/v1/resources/static-asset/css/site.css
```

### Template bundles

Global partials, base templates, and page partials use this JSON:API shape:

```json
{
    "data": {
        "type": "PagePartials",
        "attributes": {
            "bundle": [
                { "id": "header", "source": "<header>{{title}}</header>" }
            ]
        }
    }
}
```

Use type `GlobalTemplatePartials` for `/global-template-partials`,
`BaseTemplates` for `/base-templates`, and `PagePartials` for
`/page-partials{/*path}`. `bundle` must be an array and every entry must have
non-empty string `id` and `source` fields.

### Page metadata and includes

Page metadata is the attributes object itself:

```json
{
    "data": {
        "type": "PageMetadata",
        "attributes": {
            "title": "About us"
        }
    }
}
```

Page includes use `PageIncludes`; `bundle` must be a plain object whose values
are strings:

```json
{
    "data": {
        "type": "PageIncludes",
        "attributes": {
            "bundle": { "footer": "<footer>Example</footer>" }
        }
    }
}
```

### Page templates

```http
PUT /publishing-api/v1/resources/page-templates/about/page.html
Content-Type: text/plain
```

The body is template source text. No JSON:API envelope is used.

### Email assets

Email assets use type `EmailAssets`. Every attribute is optional, allowing a
partial email bundle. When present, `htmlTemplate`, `textTemplate`, and each
`partials` entry must be an object with non-empty string `id` and `source`.
`partials` must be an array; `includes` must be a plain object with string
values.

```json
{
    "data": {
        "type": "EmailAssets",
        "attributes": {
            "htmlTemplate": { "id": "welcome.html", "source": "<h1>Welcome</h1>" },
            "textTemplate": { "id": "welcome.txt", "source": "Welcome" },
            "partials": [],
            "includes": {}
        }
    }
}
```

## Publish a content tree

```http
PUT /publishing-api/v1/index/closure
Content-Type: application/vnd.api+json
```

The required resource type is `ContentTree`. It names the blobs that make up a
complete build view. Every referenced blob must have been uploaded first. An
omitted facet is absent from the new closure; this endpoint does not merge it
with the previously published tree.

```json
{
    "data": {
        "type": "ContentTree",
        "attributes": {
            "buildId": "production",
            "staticAssets": {
                "css/site.css": { "hash": "<blob-hash>", "size": 1234 }
            },
            "globalTemplatePartials": { "hash": "<blob-hash>", "size": 98 },
            "baseTemplates": { "hash": "<blob-hash>", "size": 210 },
            "pages": {
                "about": {
                    "metadata": { "hash": "<blob-hash>", "size": 41 },
                    "partials": { "hash": "<blob-hash>", "size": 62 },
                    "includes": { "hash": "<blob-hash>", "size": 19 },
                    "template": {
                        "pathname": "about/page.html",
                        "hash": "<blob-hash>",
                        "size": 28
                    }
                }
            },
            "emails": {
                "welcome": { "hash": "<blob-hash>", "size": 300 }
            }
        }
    }
}
```

`staticAssets`, `pages`, and `emails` are keyed by canonical logical pathnames:
lowercase, slash-separated, with no whitespace, dot-prefixed segments, `..`,
or duplicate slashes. Page-template `pathname` is also canonical and includes
the filename. Each reference requires a non-empty string hash and a
non-negative integer byte size; `metadata` is optional.

The response is `201 Created`:

```json
{
    "data": {
        "type": "ContentTree",
        "id": "<closure-root-hash>",
        "attributes": {
            "buildId": "production",
            "hash": "<closure-root-hash>",
            "nodeCount": 16
        }
    }
}
```

The closure root hash is deterministic for the same content tree. Publishing
the same tree again is content-idempotent, but still reassigns the named build
to that closure. The index is saved before the build pointer moves; a failed
assignment can leave an unreachable closure that a retry safely recreates.

## Typical publishing workflow

1. `GET` the current `/index` references and compare their hashes with the
   client-side content.
2. `PUT` each changed resource and retain its returned hash and size.
3. Assemble a `ContentTree` containing every resource that should exist in the
   new build, including unchanged references from step 1.
4. `PUT /index/closure` with the tree and confirm the returned build ID and
   closure hash.
