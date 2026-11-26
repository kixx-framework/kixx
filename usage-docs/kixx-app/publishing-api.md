# Publishing API v1

The Publishing API publishes and rolls back a website's content: static
assets, templates, and page metadata.

Kixx core serves it in every app, mounted at:

```text
/publishing-api/v1
```

Its routes come before every plugin's routes and the app's catch-all. It is
authenticated by the app's [deploy key](#authentication-the-deploy-key).

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

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Discovery: protocol and contract versions, running build id, addressing format, limits |
| `POST` | `/objects/status` | Which of these object ids does the store hold |
| `PUT` | `/objects/:objectId` | Upload one immutable object |
| `POST` | `/releases` | Create and fully verify a Release |
| `POST` | `/releases/validation` | Verify a Release without persisting it |
| `GET` | `/releases` | Release history |
| `GET` | `/releases/:releaseId` | Release metadata |
| `GET` | `/releases/:releaseId/manifest` | Complete manifest, for whole-site diffing |
| `GET` | `/builds` | Every registered build pointer |
| `GET` | `/builds/:buildId` | One build pointer, running or not |
| `PUT` | `/builds/:buildId` | Pre-stage a build, or publish content to it |
| `GET` | `/builds/:buildId/activations` | Activation history for that build |

Only the methods shown are allowed on a recognized path. A different method
returns `405 Method Not Allowed` with an `Allow` header.

## Authentication: the deploy key

Every request to a routed endpoint, including discovery, carries the app's
deploy key as a bearer credential. Unknown paths return `404` and disallowed
methods `405` before the key is checked, and the key is checked before the
body is read.

```http
Authorization: Bearer kxdk_<64 hex characters>
```

A deploy key is `kxdk_` followed by 64 lowercase hex characters: 256 random
bits. The server never holds the key. It holds only the key's SHA-256, as
64 lowercase hex characters, in the secret `DEPLOY_KEY_HASH`, and compares
the hash of each presented key with it in constant time. Boot fails when
`DEPLOY_KEY_HASH` is set but isn't 64 lowercase hex characters. The error
names the secret, never its value.

To make a key by hand, generate 32 random bytes as hex after `kxdk_`, keep the
key where your publishing client reads it, and set `DEPLOY_KEY_HASH` to its
SHA-256:

```bash
node --input-type=module -e "
import crypto from 'node:crypto';
const key = 'kxdk_' + crypto.randomBytes(32).toString('hex');
console.log(key);
console.log(crypto.createHash('sha256').update(key).digest('hex'));
"
```

The first line is the key; the second is the value for `DEPLOY_KEY_HASH`.

**A valid key grants the whole API.** There are no per-endpoint permissions.
The content store has no delete operation, so uploaded objects can't be
reclaimed. Share the key deliberately.

**Every environment except `development` requires `DEPLOY_KEY_HASH`.** Boot
fails without it. In `development` with no hash set, the API is open: every
request is accepted, with or without a credential. Set a hash in
`development` and it is enforced exactly as everywhere else.

The `kixx app publish` command is meant to run the whole publish workflow
below for you, but it doesn't work in this version; see
[`kixx app`](../kixx-devkit/app.md).

The objects and the manifest a publish sends are built by the content
compiler, which also checks the content first; see [Content](content.md).

### Failed attempts

A missing, malformed, or wrong key returns `401` with code
`DeployKeyRequired` and the message "A valid deploy key is required."

Failed attempts are counted per client IP in 15-minute windows. After 20
failures from one IP in a window, every further request from that IP with a
missing or wrong key returns `429` with code `TooManyFailedAttempts` and a
`Retry-After` header: the seconds left in the window. **A request with the
correct key is always accepted**, even from a limited IP, so a CI runner
sharing an IP with someone else's failures is never locked out.

Counting is best-effort. It lives in the app's key/value store, which has no
atomic increment and may lag between locations, so a burst can exceed 20
before it is refused. A failure to record an attempt never fails the request.
Requests whose client IP is unknown share one count.

Responses never contain the key or its hash.

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
| `400` | `BAD_REQUEST_ERROR` | Malformed JSON:API request, missing `attributes.manifest`, a limit exceeded (object ids, manifest entries), a `Content-Length` that isn't a decimal integer, a build write with `If-Match` or `If-None-Match`, or bad pagination (`limit` out of range, or a parameter given twice) |
| `400` | `InvalidCursor` | `cursor` is empty, or isn't one this API issued |
| `401` | `DeployKeyRequired` | The deploy key is missing, malformed, or wrong |
| `404` | `ReleaseNotFound` | No such Release, or the path id isn't a valid Release id |
| `404` | `BuildNotFound` | No such build pointer, including the target of a content-only publish |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | The method is not allowed on the recognized path |
| `409` | `JsonApiResourceTypeMismatch` | Request resource type is wrong |
| `409` | `ObjectSizeMismatch` | A stored object's size disagrees with the manifest |
| `409` | `BuildCodeUnknown` | A content-only publish targets a build with no `code`; pre-stage it with code first |
| `409` | `CodeFingerprintMismatch` | A content-only publish's `codeFingerprint` differs from the build's `code.fingerprint`; deploy the commit's code first |
| `409` | `BuildCodeMismatch` | A pre-stage's `code` differs from the code the build already has |
| `411` | `LengthRequired` | An object upload omitted `Content-Length` |
| `412` | `BuildPointerConflict` | The pointer precondition no longer holds |
| `413` | `PAYLOAD_TOO_LARGE_ERROR` | An object upload's declared `Content-Length`, or its actual body, exceeds `maxObjectBytes` |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | The request media type is not accepted |
| `422` | `ObjectIdMismatch` | Uploaded bytes do not match the object id in the URL |
| `422` | `ObjectIdInvalid` | An object id (in the URL or `attributes.objectIds`) is not a valid content address |
| `422` | `MissingContentObjects` | The manifest names objects the store does not hold |
| `422` | `InvalidProvenance` | A Release's `attributes.provenance` is invalid, including a missing or non-commit-id `sourceRevision` outside development |
| `422` | `InvalidReleaseManifest` | The manifest structure or content is invalid |
| `422` | `InvalidBuildAssignment` | `data.id` or any build-write attribute fails validation, a required attribute is missing (`intent` always; `sourceRevision`, `code`, or `codeFingerprint` outside development), an attribute is sent with the wrong intent, or the request sends an attribute protocol 4 doesn't define |
| `428` | `PreconditionRequired` | A build pointer write omitted JSON `attributes.expectedAssignmentId` |
| `429` | `TooManyFailedAttempts` | Too many failed deploy-key attempts from this IP; retry after the `Retry-After` delay with the correct key |
| `503` | `ContentStoreOverloaded` | The content store is temporarily overloaded; retry after the `Retry-After` delay |

Unexpected failures return a generic server error without internal details.

Any endpoint that reads or writes content may answer `503` with a
`Retry-After` header, in seconds. Wait at least that long, then retry
idempotent requests. Nothing was written. The `503` a running build serves
when no Release is assigned (see
[Bootstrap](#bootstrap-publishing-to-a-store-with-nothing-assigned-anywhere))
has no `Retry-After` and is not a reason to retry.

## Discovery

```http
GET /publishing-api/v1/
```

Reports the running build id, the build assignment protocol version, the
supported content contract version, the object-addressing format, and the
enforced limits. Like every endpoint, it requires the deploy key.

```json
{
    "data": {
        "type": "PublishingApi",
        "id": "v1",
        "attributes": {
            "runningBuildId": "production",
            "contentContractVersion": 2,
            "addressingFormat": 4,
            "buildAssignmentProtocolVersion": 4,
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

### Protocol versions and negotiation

`buildAssignmentProtocolVersion` is the version of this API's wire protocol.
It changes whenever a request or response shape changes. **A client reads
discovery before any write and stops unless every version it reports is one
the client speaks.** It is separate from `contentContractVersion`, which
describes Release compatibility, and from `addressingFormat`, which describes
object ids.

Protocol 4 is the current version. Against protocol 3 it:

- requires `intent` on every build write: `prestage` or `publish`
  (content-only);
- accepts `sourceRevision`, `summary`, `code` (pre-stage), `codeFingerprint`
  (content-only), `force`, and `forceReason` on build writes, and refuses
  every other new attribute;
- outside development, requires `sourceRevision` on every build write and on
  every Release's provenance (CONT-4), `code` on a pre-stage (CONT-5), and
  `codeFingerprint` on a content-only publish, and refuses a content-only
  publish whose fingerprint differs from the build's (CONT-6);
- adds `409 BuildCodeUnknown` and `409 CodeFingerprintMismatch`;
- reports `liveSourceRevision` on every Build.

Protocol 3, against protocol 2:

- authenticates with the deploy key;
- reports `createdBy` on Releases and `actor` on Activations as
  `{ type, id, name }` objects, and adds `sourceRevision`, `summary`, and
  `forceReason` to Activations;
- reports `code` on builds;
- answers an empty `cursor` with `400 InvalidCursor`;
- rejected any build-write attribute other than `releaseId`,
  `expectedAssignmentId`, and `reason`.

Build writes use JSON `expectedAssignmentId` preconditions, with no
conditional-header fallback.

### Limits

| Limit | Value | Enforced on |
| --- | --- | --- |
| `maxObjectBytes` | 26,214,400 (25 MiB) | Each uploaded object, by declared `Content-Length` and by the bytes received |
| `maxObjectStatusIds` | 100 | Unique ids in one `POST /objects/status` |
| `maxManifestEntries` | 10,000 | Entries in one Release manifest |

The content compiler enforces `maxObjectBytes` and `maxManifestEntries` too,
from the same constants, so content over either limit is refused before
anything is uploaded.

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
    --header 'Authorization: Bearer kxdk_<64 hex characters>' \
    --data-binary '@site.css' \
    http://localhost:2026/publishing-api/v1/objects/<object-id>
```

Before the body is read, a missing `Content-Length` returns
`411 LengthRequired`, one that isn't a decimal integer returns `400`, and one
over `maxObjectBytes` (25 MiB) returns `413 PAYLOAD_TOO_LARGE_ERROR`. After
the body is read, a body over `maxObjectBytes` also returns `413`, whatever
the header declared. A content-address mismatch returns
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
                }
            },
            "provenance": {
                "sourceRevision": "<40-or-64-hex-commit-id>",
                "message": "Publish the About page",
                "intendedForBuildId": "build-142"
            }
        }
    }
}
```

The manifest is a **complete replacement**: an omitted facet is absent from
the Release, never inherited from what is live.
`attributes.manifest` is required (`400` when absent). `staticAssets` and
`pages` are keyed by canonical pathnames: lowercase, one leading `/`, no
trailing slash. A non-canonical pathname is rejected, not normalized. Only
`pages` may use the root `/`. Unknown fields are rejected at every level. Each reference is
`{ objectId, size }`; static-asset references may add an optional
`mediaType`. `pages.<path>.templates` is a filename-to-reference map, letting
one page publish more than one template.

`attributes.provenance` is immutable metadata. When present it must be an
object. Its only fields are `sourceRevision`, `message`, `client`, and
`intendedForBuildId`, each a non-empty string. `client` and
`intendedForBuildId` may be at most 256 characters, and `message` at most
2,000. `intendedForBuildId` is a hint for audits; nothing stops assigning the
Release to a different build.

`sourceRevision` is the commit the Release was compiled from: 40 or 64
lowercase hex characters. **Outside development it is required (CONT-4)**;
in development it may be omitted, but a present value must still be a commit
id. Either failure is `422 InvalidProvenance` with `source`
`provenance.sourceRevision`. The server can't see git: the client checks that
the commit is pushed and the working tree clean. The same rule applies to
`POST /releases/validation`.

A Release keeps its first record, so identical content published again from
a newer commit keeps the older `sourceRevision`. The commit a build serves is
reported as the Build's `liveSourceRevision`.

Creation persists nothing if any check fails. The checks run in this order:

1. provenance validation, including CONT-4 (`422 InvalidProvenance`, every
   provenance problem at once);
2. manifest schema validation (`422 InvalidReleaseManifest`), then the
   `maxManifestEntries` (10,000) limit (`400`);
3. object existence and size verification against every referenced object id,
   together with JSON parsing and schema validation for structured payloads
   (template bundles, page metadata, includes). Errors from
   both are reported together.

The server doesn't compile templates or resolve partial references, so a
Release it accepts can still fail to render. The content compiler runs those
checks before a Release is built, and builds none when one fails; see
[Content](content.md).

A claimed size that disagrees with the stored size fails with
`409 ObjectSizeMismatch`, which takes precedence over any other error. Otherwise,
a manifest naming an object the store does not hold fails with
`422 MissingContentObjects`, listing every missing reference (up to 1000) —
not just the first. Malformed JSON or a structured
payload that violates its schema fails with
`422 InvalidReleaseManifest`. Page metadata must be a JSON object; its nested
values are not recursively validated.

The response is `201 Created`:

```json
{
    "data": {
        "type": "Release",
        "id": "<release-id>",
        "attributes": {
            "createdAt": "2026-09-01T00:00:00.000Z",
            "createdBy": {
                "type": "deploy-key",
                "id": "<first-12-hex-of-hash>",
                "name": "Deploy key"
            },
            "objectCount": 6,
            "totalBytes": 1972,
            "contractVersion": 2,
            "provenance": {
                "sourceRevision": "<40-or-64-hex-commit-id>",
                "message": "Publish the About page",
                "intendedForBuildId": "build-142"
            }
        }
    }
}
```

`createdBy` records who created the Release. Through this API it is always
the deploy key: `type` `deploy-key`, `name` `Deploy key`, and an `id` made of
the first 12 characters of the stored `DEPLOY_KEY_HASH`, so Releases created
with a rotated key can be told apart. In open development, `id` is
`development`.

`id` is the Release's closure root hash, so re-creating identical content
returns `201` with the **original** record unchanged. There are no
idempotency keys in this API. Creating a Release never assigns it to a build;
see [Assign a Release to a build](#assign-a-release-to-a-build).

## Verify a Release without publishing it

```http
POST /publishing-api/v1/releases/validation
Content-Type: application/vnd.api+json
```

Same request body as `POST /releases` and the same verification pipeline,
provenance included, but nothing is persisted. Use it to gate CI without creating a closure per candidate commit.
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
            "contractVersion": 2
        }
    }
}
```

## Release history

```http
GET /publishing-api/v1/releases?limit=25&cursor=<cursor>
```

Lists Releases newest first with stable cursor pagination. `limit` is
optional (an integer from 1 through 100, default 100); `cursor` continues a
prior page and must be the `meta.cursor` a previous page returned. An empty or
unrecognized `cursor` returns `400 InvalidCursor`, and each parameter may
appear only once. `meta.cursor` is `null` on the last page.

```json
{
    "data": [
        {
            "type": "Release",
            "id": "<release-id>",
            "attributes": {
                "createdAt": "2026-09-01T00:00:00.000Z",
                "createdBy": {
                    "type": "deploy-key",
                    "id": "<first-12-hex-of-hash>",
                    "name": "Deploy key"
                },
                "objectCount": 6,
                "totalBytes": 1972,
                "contractVersion": 2,
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
Release was ever created, or when `:releaseId` isn't a valid Release id.

```http
GET /publishing-api/v1/releases/:releaseId/manifest
```

Gets the complete manifest exactly as validated, for diffing against a local
content tree. Returns `404 ReleaseNotFound` when the Release closure is
absent, or when `:releaseId` isn't a valid Release id.

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
                "assignmentId": "<assignment-id>",
                "code": null,
                "liveSourceRevision": null
            }
        }
    ]
}
```

This includes build ids nothing is running yet.

`code` identifies the server code a build was deployed with, as
`{ revision, fingerprint }`: the commit and its code fingerprint. A pre-stage
sets it, once; it never changes afterwards. It is `null` only for a build
pre-staged in development without code. See
[`kixx/code-fingerprint/README.md`](../../kixx/code-fingerprint/README.md)
for how a fingerprint is computed.

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
            "assignmentId": "<assignment-id>",
            "code": {
                "revision": "<commit-id>",
                "fingerprint": "kxfp1:<64-hex>"
            },
            "liveSourceRevision": "<commit-id>"
        }
    }
}
```

Use it to verify a pre-staged build before deploying it.

`liveSourceRevision` is the commit the build's content was last published
from, or `null` when the newest publish named none. A changed assignment sets
it to its `sourceRevision`. A no-op assignment that names a `sourceRevision`
also sets it: a newer commit can compile to the live Release. Before a publish or deploy, a client checks that its commit
contains `liveSourceRevision` (CONT-7), unless the user forces it. The server
can't check ancestry; `expectedAssignmentId` closes the race between the
check and the write.

### Assign a Release to a build

```http
PUT /publishing-api/v1/builds/:buildId
Content-Type: application/vnd.api+json
```

Every build write declares its **intent**:

- `prestage` gives a build its code and a Release. It may create the build.
  A deploy pre-stages the new build id before its code goes live.
- `publish` is a content-only publish to a build that already exists.

A content-only publish:

```json
{
    "data": {
        "type": "Build",
        "id": "production",
        "attributes": {
            "intent": "publish",
            "releaseId": "<release-id>",
            "expectedAssignmentId": "<observed-assignment-id>",
            "reason": "publish",
            "sourceRevision": "<commit-id>",
            "codeFingerprint": "kxfp1:<64-hex>",
            "summary": "Updated the opening hours on the contact page."
        }
    }
}
```

A pre-stage:

```json
{
    "data": {
        "type": "Build",
        "id": "next",
        "attributes": {
            "intent": "prestage",
            "releaseId": "<release-id>",
            "expectedAssignmentId": null,
            "reason": "carry-forward",
            "sourceRevision": "<commit-id>",
            "code": { "revision": "<commit-id>", "fingerprint": "kxfp1:<64-hex>" }
        }
    }
}
```

| Attribute | `prestage` | `publish` | Rule |
| --- | --- | --- | --- |
| `intent` | `"prestage"` | `"publish"` | Required in every environment. |
| `releaseId` | required | required | A valid Release id. |
| `expectedAssignmentId` | required | required | See the precondition table below. |
| `reason` | optional | optional | `publish` (default), `rollback`, `carry-forward`, or `restore`. Audit metadata only. |
| `sourceRevision` | required outside development | required outside development | A commit id (40 or 64 lowercase hex). Recorded on the Activation. |
| `summary` | optional | optional | A non-empty string, at most 2,000 characters. Recorded on the Activation. |
| `code` | required outside development | refused | Exactly `{ revision, fingerprint }`: a commit id and a code fingerprint. |
| `codeFingerprint` | refused | required outside development | The code fingerprint of the commit being published. |
| `force` | optional | optional | `true` or `false`. `true` requires `forceReason`. |
| `forceReason` | only with `force: true` | only with `force: true` | A non-empty string, at most 2,000 characters. Recorded on the Activation. |

A fingerprint is `kxfp<version>:` followed by 64 lowercase hex characters
(see [`kixx/code-fingerprint/README.md`](../../kixx/code-fingerprint/README.md)).
`null` means absent for every optional attribute. Any other attribute (for
example `actor`) returns `422 InvalidBuildAssignment`. Every problem is
reported at once, each with its path as `source` (for example
`attributes.code.fingerprint`). The actor is always the deploy key; a client
can't choose one.

`data.id` must equal the route `:buildId`. A well-formed `releaseId` that
names a Release that was never created returns `404 ReleaseNotFound`.

**The gates.** After validation and the precondition checks:

- A content-only publish to a build that has never been assigned is
  `404 BuildNotFound`. Pre-stage it instead.
- Outside development, a content-only publish to a build without `code` is
  `409 BuildCodeUnknown`.
- A content-only publish whose `codeFingerprint` differs from the build's
  `code.fingerprint` is `409 CodeFingerprintMismatch` (CONT-6). The commit
  carries code the build doesn't run: deploy it first.
- A pre-stage whose `code` differs from the build's stored code is
  `409 BuildCodeMismatch`. Code is set once per build; a pre-stage that
  repeats the stored code is accepted.

A refused write changes nothing.

**`force`.** A client that has checked ancestry (CONT-7) and been told to go
ahead anyway sends `force: true` with a `forceReason`. The server records the
reason on the Activation. It skips nothing: `force` never overrides
`CodeFingerprintMismatch`, `BuildCodeUnknown`, or a missing `code`. A
fingerprint mismatch is waited out with a deploy, so a pointer-only rollback
can't go back past a code deploy; redeploy the older code instead.

**Development.** In development nothing new is required: `sourceRevision`,
`code`, and `codeFingerprint` may be omitted, but a present value is still
checked. Fingerprints are compared only when both the build's `code` and the
request's `codeFingerprint` are present, so a build pre-staged without code
takes content-only publishes.

**A JSON precondition is mandatory; there is no unconditional API form:**

| `attributes.expectedAssignmentId` | Meaning |
| --- | --- |
| Observed assignment UUID | Assign only if the build still has this assignment identity |
| `null` | Assign only if the build has no current pointer |
| Omitted, including a header-only request | `428 PreconditionRequired` |
| Malformed value or type | `422 InvalidBuildAssignment` with a field error |
| Valid UUID or null plus `If-Match` or `If-None-Match` | `400 BAD_REQUEST_ERROR`; write preconditions belong in JSON |
| Stale UUID, or null when already assigned | `412 BuildPointerConflict`, even for the currently assigned Release |

Errors are checked in this order: `422` validation, `428`, `400` for
conditional headers, the gates (`404 BuildNotFound`, `409 BuildCodeUnknown`,
`409 CodeFingerprintMismatch`), then the store: `404 ReleaseNotFound`,
`412 BuildPointerConflict`, `409 BuildCodeMismatch`.

Assigning the current Release is a success no-op only after its precondition
passes. It preserves `assignedAt` and `assignmentId` and adds no Activation,
but its `sourceRevision`, when given, becomes `liveSourceRevision`.
A→B→A creates three distinct identities, so the first A identity remains stale.

The response is `200 OK` with the resulting Build resource, including
`liveSourceRevision`. Every Publishing API response is
`Cache-Control: no-store`.

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
                "reason": "publish",
                "actor": {
                    "type": "deploy-key",
                    "id": "<first-12-hex-of-hash>",
                    "name": "Deploy key"
                },
                "sourceRevision": "<commit-id>",
                "summary": null,
                "forceReason": null
            }
        }
    ],
    "meta": { "cursor": "<next-cursor-or-null>" }
}
```

Entry `id` is `<buildId>:<assignmentId>`. Each changed assignment has exactly
one entry, identified by its `assignmentId`. `fromReleaseId` is `null` for a
build's first assignment. `actor` is who made the assignment, in the same form
as a Release's `createdBy`. `sourceRevision`, `summary`, and `forceReason` are
what the write sent, or `null`. A non-null `forceReason` records that the
client overrode its ancestry check.

**The pointer and its history entry are written together.** Every changed
assignment has an entry, and an assignment that fails writes neither: the
pointer does not move and no entry is added. Entries are never changed or
deleted.

## Workflows

Every write below runs from a clean working tree on a commit pushed to the
environment's branch; the client checks that, since the server can't. Compute
fingerprints with `kixx/code-fingerprint/` from the commit's tree.

### 1. Content-only publish

Publish a change to the site the running build already serves.

1. `GET /` for `runningBuildId`, then `GET /builds/:runningBuildId` for its
   `assignmentId`, `code`, and `liveSourceRevision`.
2. Check that the commit contains `liveSourceRevision` (CONT-7). Stop unless
   the user forces it.
3. Compare the commit's code fingerprint with `code.fingerprint`. When they
   differ, the commit's code must be deployed first (workflow 2).
4. `POST /objects/status` with local content hashes; upload only the ones
   missing with `PUT /objects/:objectId`.
5. `POST /releases` with the complete manifest and
   `provenance.sourceRevision`.
6. `PUT /builds/:runningBuildId` with `intent: "publish"`, the new
   `releaseId`, `expectedAssignmentId: "<observed-assignment-id>"`,
   `sourceRevision`, and `codeFingerprint` (plus `force: true` and
   `forceReason` when step 2 was forced).

### 2. Code-plus-content release (pre-staging)

Ship server code and content as one atomic unit.

1. Choose the `BUILD_ID` the next CI deploy will use — call it `next`.
2. Check ancestry against the running build's `liveSourceRevision`, as in
   workflow 1.
3. Upload objects and `POST /releases` as above. Neither touches a build
   pointer.
4. `PUT /builds/next` with `intent: "prestage"`, `expectedAssignmentId: null`,
   `sourceRevision`, and `code: { revision, fingerprint }` for the commit.
   `next` has never been assigned, so concurrent publishers can't both stage
   it.
5. `GET /builds/next` to verify what was staged, before triggering anything.
6. Deploy the code with `BUILD_ID=next`. The deploy is the activation.

### 3. Code-only deploy

Ship new server code with no content change.

1. `GET /builds/:runningBuildId` to read the currently served `releaseId`.
2. `PUT /builds/next` with `intent: "prestage"`, that same `releaseId`,
   `expectedAssignmentId: null`, `reason: "carry-forward"`, `sourceRevision`,
   and the new commit's `code`.
3. Deploy the code with `BUILD_ID=next`.

### 4. Rollback

1. `GET /releases` or `GET /builds/:buildId/activations` to find the Release
   to restore and the commit it was published from.
2. `GET /builds/:buildId` for its current JSON `assignmentId`.
3. `PUT /builds/:buildId` with `intent: "publish"`, `reason: "rollback"`, the
   earlier `releaseId`, JSON `expectedAssignmentId: "<observed-assignment-id>"`,
   that commit as `sourceRevision`, and its code fingerprint as
   `codeFingerprint`. A rollback goes backwards, so the client skips its
   ancestry check.

A rollback past a code deploy is refused with `409 CodeFingerprintMismatch`,
and `force` doesn't change that: redeploy the older code instead (workflow 2).

On `412 BuildPointerConflict`, stop and investigate: something else moved the
pointer, and a blind retry would overwrite that change.

### Bootstrap: publishing to a store with nothing assigned anywhere

No special endpoint is needed:

1. Upload objects and `POST /releases`; neither needs a build pointer.
2. `PUT /builds/:buildId` with `intent: "prestage"`,
   `expectedAssignmentId: null`, `sourceRevision`, and `code` makes the first
   assignment.

A running build with no Release assigned serves `503` naming the build id
until step 2 completes.
