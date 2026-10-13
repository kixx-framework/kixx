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

Read this first. **Server code and website content ship as one atomic unit**,
so code never runs against content authored for another site version. Every
endpoint below serves that guarantee.

`BUILD_ID` (an environment variable) identifies one build of the server
(Node.js process or Cloudflare Worker), and a **build pointer** records which
content **Release** that build serves. Deploying code and switching content
are **the same act**: set `BUILD_ID` to a value already pointed at the
intended Release. **There is no separate "activate" step**: a Worker deploy or
process restart is already atomic, so setting or reverting `BUILD_ID` moves
code and content together. See
[pre-staging](#2-code-plus-content-release-pre-staging).

Three objects make this work:

| Concept | Identity | Mutable | Meaning |
| --- | --- | --- | --- |
| Object | content hash | no | Immutable bytes: one file's content, addressed by its hash. No pathname, no kind, no build. |
| Release | closure root hash | no | One complete, fully verified website version — every object it names is guaranteed to exist and be servable. |
| Build pointer | operator-chosen `buildId` | yes | Which Release a given server build serves. |

A Release carries no build association, so every change is the **same
operation**, assigning an existing Release to a build id:

- **Content-only publish**: create a Release, assign it to the build that is
  already running.
- **Code-plus-content release** (pre-staging): create a Release, assign it to
  the build id CI will deploy *next*, before that build exists, then deploy.
  The deploy is the activation.
- **Code-only deploy**: assign the Release the running build already serves
  to the next build id. Just a pointer write.
- **Rollback**: assign an earlier Release back to a build id.

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

Every request to a routed endpoint, including discovery, requires a Publishing
API bearer token (unknown paths return `404` and disallowed methods `405` before
authentication):

```http
Authorization: Bearer <publishing-token>
```

Create a token through the [Admin API](admin-api.md#create-a-publishing-api-token).
Missing, malformed, or unknown bearer credentials return `401` with code
`UNAUTHENTICATED_ERROR`. Expired and revoked tokens return `403` with code
`PublishingApiTokenInactive`.

Permissions come from the token's stored roles on every request. The
`editor` role (and `root-admin`, `developer`, `admin`) can `get` and `create`
every publishing resource, and can also `update` `urn:kixx:publishing:builds`.
That is the only update grant, because moving a build pointer can never
create new content. A token without the required grant gets
`403 FORBIDDEN_ERROR`. Authentication and authorization run before the body
is read.

The content store has no delete operation, so uploaded objects can't be
reclaimed. Grant upload permission deliberately.

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

`PUT /objects/:objectId` is the one exception: its body is raw bytes with no
envelope and no required media type.

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
| `400` | `BAD_REQUEST_ERROR` | Malformed JSON:API request, missing `attributes.manifest`, a limit exceeded (object ids, manifest entries), or bad pagination |
| `401` | `UNAUTHENTICATED_ERROR` | Bearer credentials are absent, malformed, or unknown |
| `403` | `FORBIDDEN_ERROR` | The token lacks the endpoint permission |
| `403` | `PublishingApiTokenInactive` | The token is expired or revoked |
| `404` | `ReleaseNotFound` | No such Release |
| `404` | `BuildNotFound` | No such build pointer |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | The method is not allowed on the recognized path |
| `409` | `JsonApiResourceTypeMismatch` | Request resource type is wrong |
| `409` | `ObjectSizeMismatch` | A stored object's size disagrees with the manifest |
| `411` | `LengthRequired` | An object upload omitted `Content-Length` |
| `412` | `BuildPointerConflict` | The pointer precondition no longer holds |
| `413` | `PAYLOAD_TOO_LARGE_ERROR` | An object upload's declared `Content-Length` exceeds `maxObjectBytes` |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | The request media type is not accepted |
| `422` | `ObjectIdMismatch` | Uploaded bytes do not match the object id in the URL |
| `422` | `ObjectIdInvalid` | An object id (in the URL or `attributes.objectIds`) is not a valid content address |
| `422` | `MissingContentObjects` | The manifest names objects the store does not hold |
| `422` | `InvalidReleaseManifest` | The manifest structure or content, or the provenance, is invalid |
| `422` | `InvalidBuildAssignment` | `data.id`, `attributes.releaseId`, `attributes.expectedAssignmentId`, or `attributes.reason` fails validation |
| `428` | `PreconditionRequired` | A build pointer write omitted JSON `attributes.expectedAssignmentId` |

Unexpected failures return a generic server error without internal details.

## Discovery

```http
GET /publishing-api/v1/
```

Requires a valid token but no permission grant. Reports the running build id,
supported content contract version, object-addressing format, and enforced
limits.

```json
{
    "data": {
        "type": "PublishingApi",
        "id": "v1",
        "attributes": {
            "runningBuildId": "production",
            "contentContractVersion": 1,
            "addressingFormat": 4,
            "buildAssignmentProtocolVersion": 2,
            "limits": {
                "maxObjectBytes": 26214400,
                "maxObjectStatusIds": 100,
                "maxManifestEntries": 10000
            }
        }
    }
}
```

`runningBuildId` is `null` when no build id is configured. (A configured
build id with no Release assigned instead shows as `404` from
`GET /builds/:buildId`.)

`buildAssignmentProtocolVersion: 2` means build writes use JSON
`expectedAssignmentId` preconditions, with no conditional-header fallback. Its
absence means the legacy protocol; check it before writing. It is separate
from `contentContractVersion`, which describes Release compatibility.

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

`attributes.objectIds` must be an array; it is deduplicated by the server and
capped at `maxObjectStatusIds` (100) unique ids. A non-array or too many ids
returns `400`; an invalid id returns `422 ObjectIdInvalid`. The response lists only the ids that
are stored, in no promised order:

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

Use it to upload only the objects the store lacks.

## Upload an object

```http
PUT /publishing-api/v1/objects/:objectId
```

Send raw bytes as the body, with no JSON:API envelope. The server
recomputes the content address from the received bytes and compares it with
`:objectId` in the URL:

```bash
curl --request PUT \
    --header 'Authorization: Bearer kxpat_<secret>' \
    --data-binary '@site.css' \
    http://localhost:2026/publishing-api/v1/objects/<object-id>
```

Before the body is read, a missing `Content-Length` returns
`411 LengthRequired` and one over `maxObjectBytes` (25 MiB) returns
`413 PAYLOAD_TOO_LARGE_ERROR`. The server trusts the header and does not
count incoming bytes. A content-address mismatch returns
`422 ObjectIdMismatch` and stores nothing. A new object returns `201`; one
already stored returns `200`:

```json
{
    "data": {
        "type": "Object",
        "id": "<object-id>",
        "attributes": { "size": 1234 }
    }
}
```

Object endpoints never resolve a build pointer, so they work before any
build has a Release (see [Bootstrap](#bootstrap-publishing-to-a-store-with-nothing-assigned-anywhere)).

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
                    "/css/site.css": { "objectId": "<object-id>", "size": 1234 }
                },
                "globalTemplatePartials": { "objectId": "<object-id>", "size": 98 },
                "baseTemplates": { "objectId": "<object-id>", "size": 210 },
                "pages": {
                    "/about": {
                        "metadata": { "objectId": "<object-id>", "size": 41 },
                        "partials": { "objectId": "<object-id>", "size": 62 },
                        "includes": { "objectId": "<object-id>", "size": 19 },
                        "templates": {
                            "page.html": { "objectId": "<object-id>", "size": 28 }
                        }
                    }
                },
                "emails": {
                    "/welcome": { "objectId": "<object-id>", "size": 300 }
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
the Release, never inherited from what is live.
`attributes.manifest` is required (`400` when absent). `staticAssets`, `pages`,
and `emails` are keyed by canonical pathnames: lowercase, one leading `/`, no
trailing slash. A non-canonical pathname is rejected, not normalized. Only
`pages` may use the root `/`. Unknown fields are rejected at every level. Each reference is
`{ objectId, size }`; static-asset references may add an optional
`mediaType`. `pages.<path>.templates` is a filename-to-reference map, letting
one page publish more than one template.

`attributes.provenance` is optional, immutable, non-binding metadata. Its only
fields are `sourceRevision`, `message`, `client`, and `intendedForBuildId`, each
a non-empty string. `intendedForBuildId` is a hint for audits; nothing stops
assigning the Release to a different build.

Creation persists nothing if any check fails:

1. manifest schema validation, then the `maxManifestEntries` (10000) limit
   (`400`);
2. object existence and size verification against every referenced object id,
   together with JSON parsing and schema validation for structured payloads
   (template bundles, page metadata, email bundles, includes). Errors from
   both are reported together.

Templates are not compiled and partial references are not resolved, so a
valid Release can still fail to render.

A claimed size that disagrees with the stored size fails with
`409 ObjectSizeMismatch`, which takes precedence over any other error. Otherwise,
a manifest naming an object the store does not hold fails with
`422 MissingContentObjects`, listing every missing reference (up to 1000) —
not just the first. Malformed JSON or a structured
payload that violates its schema fails with
`422 InvalidReleaseManifest`. Metadata and email context data must be JSON
objects; their nested values are not recursively validated.

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

`id` is the Release's closure root hash, so re-creating identical content
returns `201` with the **original** record unchanged. There are no
idempotency keys in this API. Creating a Release never assigns it to a build;
see [Assign a Release to a build](#assign-a-release-to-a-build).

## Verify a Release without publishing it

```http
POST /publishing-api/v1/releases/validation
Content-Type: application/vnd.api+json
```

Same request body as `POST /releases` (`provenance` is ignored), same
verification pipeline, but nothing is
persisted. Use it to gate CI without creating a closure per candidate commit.
Returns `200`:

```json
{
    "data": {
        "type": "ReleaseValidation",
        "id": "<release-id>",
        "attributes": {
            "releaseId": "<release-id>",
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
optional (1 through 100, default 100); `cursor` continues a prior page.
`meta.cursor` is `null` on the last page.

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

Gets the complete manifest exactly as validated, for diffing against a local
content tree. Returns `404 ReleaseNotFound` when the Release closure is absent.

```json
{
    "data": {
        "type": "ReleaseManifest",
        "id": "<release-id>",
        "attributes": { "manifest": {} }
    }
}
```

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
                "assignedAt": "2026-09-01T00:00:00.000Z",
                "assignmentId": "<assignment-id>"
            }
        }
    ]
}
```

This includes build ids nothing is running yet.

```http
GET /publishing-api/v1/builds/:buildId
```

Gets one build's pointer, running or not. Returns `404 BuildNotFound` when
the build has never been assigned. Copy `attributes.assignmentId` verbatim
into the next write's precondition. Every changed assignment gets a new UUID,
even when returning to an earlier Release. Build responses carry no `ETag`:

```json
{
    "data": {
        "type": "Build",
        "id": "production",
        "attributes": {
            "releaseId": "<release-id>",
            "assignedAt": "2026-09-01T00:00:00.000Z",
            "assignmentId": "<assignment-id>"
        }
    }
}
```

Use it to verify a pre-staged build before deploying it.

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
            "expectedAssignmentId": "<observed-assignment-id>",
            "reason": "publish"
        }
    }
}
```

`data.id` must equal the route `:buildId`, and `attributes.releaseId` must be
a syntactically valid content address; either failing, or an unrecognized
`attributes.reason`, returns `422 InvalidBuildAssignment`. A well-formed
`releaseId` that names a Release that was never created returns
`404 ReleaseNotFound`. `attributes.reason` is optional audit metadata
(`publish`, default; `rollback`; `carry-forward`; `restore`) and changes no
behavior.

**A JSON precondition is mandatory; there is no unconditional API form:**

| `attributes.expectedAssignmentId` | Meaning |
| --- | --- |
| Observed assignment UUID | Assign only if the build still has this assignment identity |
| `null` | Assign only if the build has no current pointer |
| Omitted, including a header-only request | `428 PreconditionRequired` |
| Malformed token or type | `422 InvalidBuildAssignment` with a field error |
| Valid token or null plus `If-Match` or `If-None-Match` | `400 BAD_REQUEST_ERROR`; write preconditions belong in JSON |
| Stale UUID, or null when already assigned | `412 BuildPointerConflict`, even for the currently assigned Release |

A valid request naming a missing Release returns `404 ReleaseNotFound` before
checking for a stale identity.

Assigning the current Release is a success no-op only after its precondition
passes. It preserves `assignedAt` and `assignmentId` and adds no Activation.
A→B→A creates three distinct identities, so the first A token remains stale.

The response is `200 OK` with the resulting Build resource. Authenticated
responses are `Cache-Control: private, no-store`.

If a response is lost after a successful assignment, read the current Build
and reconcile before acting. Retrying the same request may return `412`
because the identity already changed. There is no unconditional retry.

## Build activation history

```http
GET /publishing-api/v1/builds/:buildId/activations?limit=25&cursor=<cursor>
```

Lists every changed assignment to one build, newest first, paginated like
`GET /releases`. A successful
same-target no-op creates no entry. Returns
`404 BuildNotFound` when the build has never been assigned.

```json
{
    "data": [
        {
            "type": "Activation",
            "id": "production:<assignment-id>",
            "attributes": {
                "buildId": "production",
                "assignmentId": "<assignment-id>",
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

Entry `id` is `<buildId>:<assignmentId>`, so one assignment has at most one
entry; appending it twice rewrites that entry.

**History is best-effort, not an audit guarantee.** The pointer commits
first, then the server makes one attempt to append the Activation. A crash,
timeout, or storage failure between the two leaves a permanent gap: nothing
retries the append. The pointer is authoritative; a missing entry never
blocks the next publish.

## Workflows

### 1. Content-only publish

Publish a change to the site the running build already serves.

1. `POST /objects/status` with local content hashes; upload only the ones
   missing with `PUT /objects/:objectId`.
2. `POST /releases` with the complete manifest.
3. `GET /builds/:buildId` for the running build to retrieve its current
   JSON `assignmentId`.
4. `PUT /builds/:buildId` with the new `releaseId` and JSON
   `expectedAssignmentId: "<observed-assignment-id>"`.

### 2. Code-plus-content release (pre-staging)

Ship server code and content as one atomic unit.

1. Choose the `BUILD_ID` the next CI deploy will use — call it `next`.
2. Upload objects and `POST /releases` as above. Neither touches a build
   pointer.
3. `PUT /builds/next` with `expectedAssignmentId: null`. `next` has never been
   assigned, so concurrent publishers can't both stage it.
4. `GET /builds/next` to verify what was staged, before triggering anything.
5. Deploy the code with `BUILD_ID=next`. The deploy is the activation.

### 3. Code-only deploy

Ship new server code with no content change.

1. `GET /builds/:runningBuildId` to read the currently served `releaseId`.
2. `PUT /builds/next` with that same `releaseId` and `expectedAssignmentId: null` in JSON.
3. Deploy the code with `BUILD_ID=next`.

### 4. Rollback

1. `GET /releases` or `GET /builds/:buildId/activations` to find the Release
   to restore.
2. `GET /builds/:buildId` for its current JSON `assignmentId`.
3. `PUT /builds/:buildId` with the earlier `releaseId` and JSON
   `expectedAssignmentId: "<observed-assignment-id>"`.

On `412 BuildPointerConflict`, stop and investigate: something else moved the
pointer, and a blind retry would overwrite that change.

### Bootstrap: publishing to a store with nothing assigned anywhere

No special endpoint is needed:

1. Upload objects and `POST /releases`; neither needs a build pointer.
2. `PUT /builds/:buildId` with `expectedAssignmentId: null` makes the first
   assignment.

A running build with no Release assigned serves `503` naming the build id
until step 2 completes.
