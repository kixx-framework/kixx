# Publishing API v1

The Publishing API publishes and rolls back a website's content: static
assets, templates, page metadata, and email content.

The API is mounted at:

```text
/publishing-api/v1
```

Examples in this document use `http://localhost:2026`, the default development
server origin.

## The atomic release model

Read this section before using any endpoint below. Misunderstanding it leads
to misusing every endpoint that follows.

A release of server-side code and a release of website content ship as one
atomic unit. The mechanism is the `BUILD_ID` environment variable: it
identifies one build of the server source (Node.js process or Cloudflare
Worker), and a **build pointer** records which content **Release** that build
serves. There is no separate "activate" step — a Worker deploy and a process
restart are already atomic, so reverting `BUILD_ID` reverts the code and the
content it was authored against as a single coordinate.

Three objects make this work:

| Concept | Identity | Mutable | Meaning |
| --- | --- | --- | --- |
| Object | content hash | no | Immutable bytes: one file's content, addressed by its hash. No pathname, no kind, no build. |
| Release | closure root hash | no | One complete, fully verified website version — every object it names is guaranteed to exist and be servable. |
| Build pointer | operator-chosen `buildId` | yes | Which Release a given server build serves. |

Because a Release carries no build association, publishing forward,
rolling back, and carrying code-only content forward are all the **same
operation** — assigning an existing Release to a build id — differing only
in which build id and which Release:

- **Content-only publish**: create a Release, assign it to the build that is
  already running.
- **Code-plus-content release**: create a Release, assign it to the build id
  that CI will deploy *next* — before that build exists — then deploy the
  code. This is pre-staging: a publishing client chooses the `BUILD_ID` a
  future deploy will use, uploads and verifies content against it first, and
  only then triggers the deploy. The deploy is the activation.
- **Code-only deploy**: assign the *same* Release the running build already
  serves to the next build id. No manifest, no re-upload — just a pointer
  write.
- **Rollback**: assign an earlier Release back to a build id.

A named channel (`production`) that survives code deploys was considered and
rejected: it would let one build's code serve content authored for a
different build, which is exactly the mismatch this model prevents.

### Cloudflare consistency note

On Cloudflare, blobs live in KV, which is eventually consistent; build
pointers and the object registry live in a Durable Object, which is strongly
consistent. A Release can therefore validate successfully while a freshly
uploaded blob is not yet readable in every colo. Pre-staging absorbs this
gap: content is published, verified, and given time to propagate *before*
the deploy that serves it goes live. This is another reason to prefer
pre-staging over publishing straight to a running build.

## Endpoint summary

| Method | Path | Required permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | Authenticated (no additional grant) | Discovery: contract version, running build id, addressing format, limits |
| `POST` | `/objects/status` | `urn:kixx:create` on `urn:kixx:publishing:objects` | Which of these object ids does the store hold |
| `PUT` | `/objects/:objectId` | `urn:kixx:create` on `urn:kixx:publishing:objects` | Upload one immutable object |
| `POST` | `/releases` | `urn:kixx:create` on `urn:kixx:publishing:releases` | Create and fully verify a Release |
| `POST` | `/releases/validation` | `urn:kixx:create` on `urn:kixx:publishing:releases` | Verify a Release without persisting it |
| `GET` | `/releases` | `urn:kixx:get` on `urn:kixx:publishing:releases` | Release history |
| `GET` | `/releases/:releaseId` | `urn:kixx:get` on `urn:kixx:publishing:releases` | Release metadata |
| `GET` | `/releases/:releaseId/manifest` | `urn:kixx:get` on `urn:kixx:publishing:releases` | Complete manifest, for whole-site diffing |
| `GET` | `/builds` | `urn:kixx:get` on `urn:kixx:publishing:builds` | Every registered build pointer |
| `GET` | `/builds/:buildId` | `urn:kixx:get` on `urn:kixx:publishing:builds` | One build pointer, running or not |
| `PUT` | `/builds/:buildId` | `urn:kixx:update` on `urn:kixx:publishing:builds` | Assign a Release to that build |
| `GET` | `/builds/:buildId/activations` | `urn:kixx:get` on `urn:kixx:publishing:builds` | Activation history for that build |

Only the methods shown are allowed on a recognized path. A different method
returns `405 Method Not Allowed` with an `Allow` header.

## Authentication and authorization

Every request, including discovery, requires a Publishing API bearer token:

```http
Authorization: Bearer <publishing-token>
```

Create a token through the [Admin API](admin-api.md#create-a-publishing-api-token).
Missing, malformed, or unknown bearer credentials return `401` with code
`UNAUTHENTICATED_ERROR`. Expired and revoked tokens return `403` with code
`PublishingApiTokenInactive`.

Permissions are derived from the token's stored roles for every request. The
`editor` role (and `root-admin`, `developer`, `admin`) can `get` and `create`
across every publishing resource, and can additionally `update`
`urn:kixx:publishing:builds` — the one resource a publishing-capable role may
mutate rather than only create, because assigning a build pointer moves an
existing, already-published Release and can never create new content. An
authenticated token without the required grant receives `403 FORBIDDEN_ERROR`.

Authentication and authorization occur before an endpoint reads or validates
a request body.

Creating an object consumes storage nothing can currently reclaim — the
content store has no delete operation — so object upload permission is worth
granting deliberately. The 25 MiB per-object cap and the 100-id status cap
are the only current bound.

## Protocol conventions

### JSON:API documents

All successful responses are JSON:API documents with:

```http
Content-Type: application/vnd.api+json; charset=utf-8
```

Every JSON write endpoint (`POST /objects/status`, `POST /releases`,
`POST /releases/validation`, `PUT /builds/:buildId`) requires:

```http
Content-Type: application/vnd.api+json
```

Media-type parameters such as `charset=utf-8` are accepted. A missing or
different media type returns `415 Unsupported Media Type`.

Those endpoints accept one resource document:

```json
{
    "data": {
        "type": "ResourceType",
        "attributes": {}
    }
}
```

`data` and `data.attributes` must be objects, and `data.type` must be a
non-empty string. A malformed document returns `400 Bad Request`; an
incorrect resource type returns `409 Conflict` with code
`JsonApiResourceTypeMismatch`.

`PUT /objects/:objectId` is the one exception: its body is raw, non-empty
bytes with no envelope and no required media type, exactly like
static-asset uploads elsewhere in this project.

### Error documents

Expected errors use JSON:API error documents. Error `status` values are
strings; a validation failure can carry more than one error object, each with
a JSON-pointer-style `source`:

```json
{
    "errors": [
        {
            "status": "422",
            "code": "VALIDATION_ERROR",
            "title": "ValidationError",
            "detail": "Object \"<hash>\" is missing",
            "source": "/pages/about/template"
        }
    ]
}
```

Error codes used by this API:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `BAD_REQUEST_ERROR` | Malformed JSON:API request, bad pagination, or inline content used outside Release creation |
| `401` | `UNAUTHENTICATED_ERROR` | Bearer credentials are absent, malformed, or unknown |
| `403` | `FORBIDDEN_ERROR` | The token lacks the endpoint permission |
| `403` | `PublishingApiTokenInactive` | The token is expired or revoked |
| `404` | `ReleaseNotFound` | No such Release |
| `404` | `BuildNotFound` | No such build pointer |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | The method is not allowed on the recognized path |
| `409` | `JsonApiResourceTypeMismatch` | Request resource type is wrong |
| `409` | `ObjectSizeMismatch` | A stored object's size disagrees with the manifest |
| `412` | `BuildPointerConflict` | The pointer precondition no longer holds |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | The request media type is not accepted |
| `422` | `ObjectIdMismatch` | Uploaded bytes do not match the object id in the URL |
| `422` | `ObjectIdInvalid` | An object id is not a valid content address |
| `422` | `MissingContentObjects` | The manifest names objects the store does not hold |
| `422` | `InvalidReleaseManifest` | The manifest structure or content is invalid |
| `428` | `PreconditionRequired` | A build pointer write omitted `If-Match`/`If-None-Match` |

Unexpected storage failures are not part of the public contract and are
reported as server failures without exposing internal details.

## Discovery

```http
GET /publishing-api/v1/
```

Requires a valid bearer token but no specific permission grant. Reports the running deploy's own build id,
the content contract version this code supports, the object-addressing
format, and every enforced limit, so a client can adapt before making a
mistake a later request would reject.

```json
{
    "data": {
        "type": "PublishingApi",
        "id": "v1",
        "attributes": {
            "runningBuildId": "production",
            "contentContractVersion": 1,
            "addressingFormat": 3,
            "limits": {
                "maxObjectBytes": 26214400,
                "maxObjectStatusIds": 100,
                "maxManifestEntries": 10000,
                "maxInlineContentBytes": 262144
            }
        }
    }
}
```

`runningBuildId` is `null` when the deploy has no runtime build id
configured at all — a configuration state distinct from a build id that has
never been assigned a Release, which `GET /builds/:buildId` reports as `404`.

## Check which objects are already stored

```http
POST /publishing-api/v1/objects/status
Content-Type: application/vnd.api+json
```

```json
{
    "data": {
        "type": "ObjectStatus",
        "attributes": {
            "objectIds": [ "<object-id-1>", "<object-id-2>" ]
        }
    }
}
```

`attributes.objectIds` is deduplicated by the server and capped at
`maxObjectStatusIds` (100) unique ids. The response lists only the ids that
are actually stored, as a set with no promised order — an id absent from the
response is not stored:

```json
{
    "data": [
        {
            "type": "Object",
            "id": "<object-id-1>",
            "attributes": { "size": 1234 }
        }
    ]
}
```

Use this before uploading a local content tree, to send bytes only for
objects the store does not already have.

## Upload an object

```http
PUT /publishing-api/v1/objects/:objectId
```

Send raw, non-empty bytes as the body, with no JSON:API envelope. The server
recomputes the content address from the received bytes and compares it with
`:objectId` in the URL:

```bash
curl --request PUT \
    --header 'Authorization: Bearer kxpat_<secret>' \
    --data-binary '@site.css' \
    http://localhost:2026/publishing-api/v1/objects/<object-id>
```

A mismatch returns `422 ObjectIdMismatch` and stores nothing. On success the
response distinguishes a newly stored object (`201 Created`) from one that
was already present (`200 OK`), so a client can report how many bytes it
actually transferred:

```json
{
    "data": {
        "type": "Object",
        "id": "<object-id>",
        "attributes": { "size": 1234 }
    }
}
```

Uploading works even when no build anywhere has ever been assigned a
Release — the object endpoints never resolve a build pointer, which is what
makes bootstrapping a brand-new site possible.

## Create a Release

```http
POST /publishing-api/v1/releases
Content-Type: application/vnd.api+json
```

```json
{
    "data": {
        "type": "Release",
        "attributes": {
            "manifest": {
                "staticAssets": {
                    "css/site.css": { "objectId": "<object-id>", "size": 1234 }
                },
                "globalTemplatePartials": { "objectId": "<object-id>", "size": 98 },
                "baseTemplates": { "objectId": "<object-id>", "size": 210 },
                "pages": {
                    "about": {
                        "metadata": { "objectId": "<object-id>", "size": 41 },
                        "partials": { "objectId": "<object-id>", "size": 62 },
                        "includes": { "objectId": "<object-id>", "size": 19 },
                        "templates": {
                            "page.html": { "objectId": "<object-id>", "size": 28 }
                        }
                    }
                },
                "emails": {
                    "welcome": { "objectId": "<object-id>", "size": 300 }
                }
            },
            "provenance": {
                "sourceRevision": "a1b2c3d",
                "message": "Publish the About page",
                "intendedForBuildId": "build-142"
            }
        }
    }
}
```

The manifest is a **complete replacement**: an omitted facet is absent from
the Release, and never inherits from whatever is currently live.
`staticAssets`, `pages`, and `emails` are keyed by canonical logical
pathnames — lowercase-insensitive is not applied; a non-canonical pathname is
rejected outright rather than normalized. Each reference is
`{ objectId, size }`; static-asset references may add an optional
`mediaType`. `pages.<path>.templates` is a filename-to-reference map, letting
one page publish more than one template.

`attributes.provenance` is optional, immutable, non-binding metadata:
`sourceRevision`, `message`, `client`, and `intendedForBuildId` (the build id
this Release was authored for — a hint for pre-staging audits, not a binding
constraint; nothing prevents assigning a Release to a different build id).

Creation runs, and fails before persisting anything if any step fails:

1. manifest schema validation;
2. object existence and size verification against every referenced object id;
3. structured payload parsing (template bundles, page metadata, email
   bundles, includes);
4. template compilation with the same compiler used at runtime;
5. resolution of every base template and partial each page and email refers
   to.

A manifest naming an object the store does not hold fails with
`422 MissingContentObjects`, listing every missing reference — not just the
first — up to a documented cap. A claimed size that disagrees with the
stored size fails with `409 ObjectSizeMismatch`. A template that does not
compile, or that references an unresolvable partial, fails with
`422 InvalidReleaseManifest`.

The response is `201 Created`:

```json
{
    "data": {
        "type": "Release",
        "id": "<release-id>",
        "attributes": {
            "createdAt": "2026-09-01T00:00:00.000Z",
            "createdBy": "<publishing-token-id>",
            "objectCount": 6,
            "totalBytes": 1972,
            "contractVersion": 1,
            "provenance": {
                "sourceRevision": "a1b2c3d",
                "message": "Publish the About page",
                "intendedForBuildId": "build-142"
            }
        }
    }
}
```

`id` is the Release's closure root hash, so re-creating byte-identical
content returns the **original** Release record unchanged — creation is
content-idempotent, and there are no idempotency keys anywhere in this API.
Creating a Release never assigns it to any build; see
[Assign a Release to a build](#assign-a-release-to-a-build) below.

### Inline content

A manifest reference may carry inline text instead of an `objectId`, for a
small site that wants to publish in one request:

```json
{ "content": "body { margin: 0; }", "mediaType": "text/css" }
```

The server hashes and stores the content as an object during Release
creation, subject to `maxInlineContentBytes` (256 KiB) total across the
whole manifest. Inline content is accepted only when creating a Release —
`POST /releases/validation` returns `400 Bad Request` if the manifest
contains any, because validation must never persist anything, including the
object an inline reference would otherwise create.

## Verify a Release without publishing it

```http
POST /publishing-api/v1/releases/validation
Content-Type: application/vnd.api+json
```

Same request body as `POST /releases` (minus inline content), same
verification pipeline, but nothing is persisted on success or failure — no
objects, no closure, no Release record. Use this to gate a CI build without
creating an unreferenced closure for every candidate commit.

```json
{
    "data": {
        "type": "ReleaseValidation",
        "id": "<release-id>",
        "attributes": {
            "objectCount": 6,
            "totalBytes": 1972,
            "contractVersion": 1
        }
    }
}
```

## Release history

```http
GET /publishing-api/v1/releases?limit=25&cursor=<cursor>
```

Lists Releases newest first with stable cursor pagination. `limit` is
optional (1 through 100); `cursor` continues a prior page.

```json
{
    "data": [
        {
            "type": "Release",
            "id": "<release-id>",
            "attributes": {
                "createdAt": "2026-09-01T00:00:00.000Z",
                "createdBy": "<publishing-token-id>",
                "objectCount": 6,
                "totalBytes": 1972,
                "contractVersion": 1,
                "provenance": {}
            }
        }
    ],
    "meta": { "cursor": "<next-cursor-or-null>" }
}
```

```http
GET /publishing-api/v1/releases/:releaseId
```

Gets one Release's metadata. Returns `404 ReleaseNotFound` when no such
Release was ever created.

```http
GET /publishing-api/v1/releases/:releaseId/manifest
```

Gets the complete manifest stored inside the Release's immutable closure —
every reference it names, exactly as validated. Use this for whole-site
diffing against a local content tree, without walking per-pathname
endpoints. Returns `404 ReleaseNotFound` when the Release closure is absent.

## Build pointers

```http
GET /publishing-api/v1/builds
```

Lists every registered build pointer, newest assignment first:

```json
{
    "data": [
        {
            "type": "Build",
            "id": "production",
            "attributes": {
                "releaseId": "<release-id>",
                "assignedAt": "2026-09-01T00:00:00.000Z"
            }
        }
    ]
}
```

This is what surfaces a phantom build id created by a typo during
pre-staging — it appears here even though nothing is running it yet.

```http
GET /publishing-api/v1/builds/:buildId
```

Gets one build's authoritative pointer, whether or not that build is
currently running. Returns `404 BuildNotFound` when the build has never been
assigned. The response carries an `ETag` — the quoted Release id — for use as
a precondition on a subsequent `PUT`:

```http
HTTP/1.1 200 OK
ETag: "<release-id>"
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "Build",
        "id": "production",
        "attributes": {
            "releaseId": "<release-id>",
            "assignedAt": "2026-09-01T00:00:00.000Z"
        }
    }
}
```

This is the endpoint that makes pre-staging verifiable: read back what was
just staged for a build id nothing is running yet, before triggering the
deploy that will run it.

### Assign a Release to a build

```http
PUT /publishing-api/v1/builds/:buildId
Content-Type: application/vnd.api+json
```

```json
{
    "data": {
        "type": "Build",
        "id": "production",
        "attributes": {
            "releaseId": "<release-id>",
            "reason": "publish"
        }
    }
}
```

`data.id` must equal the route `:buildId`. `attributes.releaseId` must name
an existing Release — a Release id that was never created returns
`404 ReleaseNotFound`. `attributes.reason` is optional audit metadata
(`publish`, default; `rollback`; `carry-forward`; `restore`) and changes no
behavior.

**A precondition is mandatory; there is no unconditional form:**

| Header | Meaning |
| --- | --- |
| `If-Match: "<release-id>"` | Assign only if the build's current pointer still equals this Release id |
| `If-None-Match: *` | Assign only if the build has no current pointer (pre-staging a build id for the first time, or bootstrapping) |
| neither | `428 PreconditionRequired` |
| present but stale | `412 BuildPointerConflict` |

Assigning the Release a build already points at is a **success no-op**, not
a conflict — this is what makes retry-after-lost-response and an
unconditional restore script safe.

The response is `200 OK` with the resulting Build resource and a matching
`ETag`.

## Build activation history

```http
GET /publishing-api/v1/builds/:buildId/activations?limit=25&cursor=<cursor>
```

Lists every successful assignment to one build, newest first. Returns
`404 BuildNotFound` when the build has never been assigned.

```json
{
    "data": [
        {
            "type": "Activation",
            "id": "<activation-id>",
            "attributes": {
                "buildId": "production",
                "fromReleaseId": "<previous-release-id>",
                "toReleaseId": "<release-id>",
                "activatedAt": "2026-09-01T00:00:00.000Z",
                "activatedBy": "<publishing-token-id>",
                "reason": "publish"
            }
        }
    ],
    "meta": { "cursor": "<next-cursor-or-null>" }
}
```

Together with `GET /releases`, this is enough to plan and execute a rollback
using no root hash the client happened to keep from an earlier publish.

## Workflows

### 1. Content-only publish

Publish a change to the site the running build already serves.

1. `POST /objects/status` with local content hashes; upload only the ones
   missing with `PUT /objects/:objectId`.
2. `POST /releases` with the complete manifest.
3. `GET /builds/:buildId` for the running build to retrieve its current
   `ETag`.
4. `PUT /builds/:buildId` with the new `releaseId` and
   `If-Match: "<current-release-id>"`.

### 2. Code-plus-content release (pre-staging)

Ship server code and content as one atomic unit.

1. Choose the `BUILD_ID` the next CI deploy will use — call it `next`.
2. Upload objects and `POST /releases` as above, against the running build's
   code (or a scratch client that only needs the object and Release
   endpoints — neither touches any build pointer).
3. `PUT /builds/next` with `If-None-Match: *` — `next` has never been
   assigned, so this is safe even under concurrent publishers racing to
   stage the same future build.
4. `GET /builds/next` to verify what was staged, before triggering anything.
5. Deploy the code with `BUILD_ID=next`. The deploy is the activation; no
   further request against this API is needed.

### 3. Code-only deploy

Ship new server code with no content change: two small requests, no
manifest.

1. `GET /builds/:runningBuildId` to read the currently served `releaseId`.
2. `PUT /builds/next` with that same `releaseId` and `If-None-Match: *`.
3. Deploy the code with `BUILD_ID=next`.

### 4. Rollback

1. `GET /releases` or `GET /builds/:buildId/activations` to find the Release
   to restore — no client-retained root hash is required.
2. `GET /builds/:buildId` for the current `ETag`.
3. `PUT /builds/:buildId` with the earlier `releaseId` and
   `If-Match: "<current-release-id>"`.

Stop and investigate on `412 BuildPointerConflict` rather than retrying
blindly — it means something else moved the pointer in the meantime, and a
blind retry would silently overwrite that concurrent change.

### Bootstrap: publishing to a store with nothing assigned anywhere

No special-cased endpoint exists for first boot, because none is needed:

1. `PUT /objects/:objectId` works before any build pointer exists anywhere —
   object endpoints never resolve one.
2. `POST /releases` works the same way.
3. `PUT /builds/:buildId` with `If-None-Match: *` makes the very first
   assignment for that build id, exactly like pre-staging a future build.

A build whose code is already running but has no Release assigned serves
`503` naming the build id, rather than crashing, until step 3 completes.
