# Administrative Data API v1

The Administrative Data API gives trusted operators and their tools direct,
version-checked access to application records through JSON:API resource
documents. It is an escape hatch for administration: writes go straight to a
Collection and **bypass application workflows** such as publication guards or
content cleanup. They never bypass Record validation or the resource
registration's field restrictions.

The API is mounted at:

```text
/admin-data-api/v1/
```

## Exposure model

Nothing is exposed by default. A Collection is reachable only when the
application registers it in `src/app/admin-data-api/mod.js`, and only through
the operations that registration declares. There is no automatic Collection
enumeration and no wildcard grant to future Collections.

A request is allowed only when **both** hold:

1. The current registration for the resource type enables the operation.
2. The caller's token grants that action on that exact Collection.

A token grant for a Collection that is no longer registered, or for an
operation the registration no longer enables, confers nothing. Discovery
describes the same intersection, but it is advisory: every request is
authorized on its own.

## Authentication and grants

Requests authenticate with an Administrative Data API bearer token:

```http
Authorization: Bearer kxadt_<secret>
```

These tokens are a separate credential domain. Publishing API tokens
(`kxpat_`), admin passwords, and HTTP Basic credentials are rejected. A missing,
malformed, unknown, expired, or revoked token returns `401` with a
`WWW-Authenticate: Bearer` challenge; expired and revoked tokens carry code
`AdminDataApiTokenInactive`.

The server stores only the SHA-256 digest of each token, so a lost secret
cannot be recovered; mint a new token. Token state is read on every request:
a revocation applies to every request that authenticates after it is stored,
but does not cancel a request that had already authenticated.

Each token carries immutable, explicit grants:

```json
[
    { "collection": "File", "actions": [ "list", "get" ] }
]
```

Actions are `list`, `get`, `create`, `update`, and `delete`. A grant maps to
the evaluator permission `urn:kixx:<action>` on the exact resource
`urn:kixx:admin-data:collections:<Collection>`. To change a token's access,
mint a replacement and revoke the old token.

### Who can manage tokens

Tokens are created and revoked in the admin panel. That requires the
`urn:kixx:admin:api-tokens:admin-data` resource, held by:

| Role | Can manage data tokens | How |
| --- | --- | --- |
| Root Admin | Yes | Global `*` grant |
| Developer | Yes | `*` on `urn:kixx:admin:api-tokens:*` |
| Admin | No | |
| Editor | No | |

Management authority covers only registered resources and their enabled
operations. An API token can never mint tokens or extend its own grants.

## Protocol

### Media types

Request bodies must use `Content-Type: application/vnd.api+json`. The only
media type parameter accepted is `profile`; anything else, including
`charset` or an `ext` (no extensions are supported), is `415`. Responses use
exactly `application/vnd.api+json`. An `Accept` header that lists the JSON:API
media type only with parameters other than `profile` (and the `q` weight) is
`406`; an absent `Accept`, or one without the JSON:API media type, is not
rejected.

Responses are never cacheable: authenticated responses are
`Cache-Control: private, no-store`, and errors raised before authentication
succeeds are `no-store`.

### Discovery

`GET /admin-data-api/v1/` describes what the caller can do. Each accessible
resource appears once with its authorized actions and only the contracts for
those actions:

```json
{
    "meta": {
        "resources": [
            {
                "type": "files",
                "collection": "File",
                "description": "File metadata records and their content references. ...",
                "actions": [ "list", "get", "update" ],
                "attributes": {
                    "title": {
                        "description": "Display title, or null.",
                        "schema": { "type": [ "string", "null" ], "maxLength": 200 }
                    }
                },
                "list": {
                    "sort": [ { "name": "-originalUploadedAt", "description": "Newest upload first." } ],
                    "defaultSort": "-originalUploadedAt",
                    "page": { "defaultSize": 25, "maxSize": 100 }
                },
                "update": { "attributes": [ "title", "description", "isPublished", "content" ] }
            }
        ]
    }
}
```

### Resource documents and versions

Resources are addressed as `/admin-data-api/v1/<type>/<id>`. A resource read
returns only the registration's declared attributes, plus server-owned metadata:

```json
{
    "data": {
        "type": "files",
        "id": "1f0c...",
        "attributes": { "title": "Logo", "isPublished": false },
        "meta": {
            "version": 3,
            "createdAt": "2026-10-01T12:00:00.000Z",
            "updatedAt": "2026-10-01T12:05:00.000Z"
        },
        "links": { "self": "/admin-data-api/v1/files/1f0c..." }
    }
}
```

Storage identity, `version`, timestamps, and sort keys are server-owned. They
never appear in `attributes` and cannot be written.

Sparse fieldsets (`fields[files]=title,content`) narrow the attributes
returned. They can only remove declared attributes, never add others; an
unknown field name is `400`.

### Writes

- **Create** — `POST /admin-data-api/v1/<type>` with
  `{ "data": { "type": "<type>", "attributes": { ... } } }`. The server
  generates the id; a client-supplied `data.id` is `403`. Every required create
  attribute must be present. Success is `201` with a `Location` header.
- **Update** — `PATCH /admin-data-api/v1/<type>/<id>` with `data.type`,
  `data.id`, the attributes to change, and the version the client last read in
  `data.meta.version`. Omitted attributes are preserved. A supplied attribute
  replaces the stored value whole (nested objects are not merged), and an
  explicit `null` is validated like any other value.
- **Delete** — `DELETE /admin-data-api/v1/<type>/<id>` with the observed
  version in the `Kixx-Expected-Version` header and no body. Success is `204`.

Only attributes listed for the operation are accepted. An undeclared or
read-only attribute is `422` and nothing is stored. Relationships, bulk
writes, and client-generated ids are not supported.

Versions are checked, never retried. The server compares the supplied version
with the stored record and persists conditionally on that same version, so
two clients that read the same version cannot both update or delete it: the
second receives `409`. Re-read the resource and decide again.

### Lists and pagination

`GET /admin-data-api/v1/<type>` returns a page of resources.

| Parameter | Meaning |
| --- | --- |
| `sort` | One of the registration's declared sort names. Defaults to the first. |
| `page[size]` | 1–100; defaults to 25. |
| `page[after]` | Opaque cursor from a previous `links.next`. |
| `fields[<type>]` | Sparse fieldset. |

Only declared sorts are allowed; arbitrary filters, index selection, and total
counts are not supported, so `filter[...]`, `include`, and any other parameter
is `400`, as is any parameter given more than once. The response carries
`links.self` (the request URL) and, when more results exist, `links.next`: a
complete URL repeating whichever of `sort`, `page[size]`, and `fields` the
request supplied. Follow `links.next` rather than building cursors. Cursors
are signed; a tampered cursor, or one used with a different sort, is `400`.
The last page has no `links.next`.

Single-resource reads and writes accept only `fields[<type>]`; delete and
discovery accept no query parameters.

### Errors

Errors use JSON:API error documents with a `status`, `code`, `title`,
`detail`, and, where applicable, `source.pointer` (body members, e.g.
`/data/attributes/content/key`), `source.parameter` (query parameters), or
`source.header`. An invalid record produces one error object per invalid
field. Internal details and causes are never included; an unexpected server
fault is a generic `500`.

Checks run in this order, so a token without the grant learns nothing about
what a valid request would look like: authentication, `Accept`, resource type,
operation (`405`), grant (`403`), then query parameters and the body. The one
exception is the discovery URL, which serves only `GET`: the router answers
any other method there with `405` before authenticating.

| Status | When |
| --- | --- |
| `400` | Malformed JSON or document (`JsonApiInvalidDocument`), missing/invalid version (`AdminDataInvalidVersion`), invalid query parameter, sort, fieldset, or page size (`JsonApiInvalidQueryParameter`), or cursor (`AdminDataInvalidCursor`) |
| `401` | Missing or invalid bearer token. `WWW-Authenticate: Bearer realm="admin-data-api"`, plus `error="invalid_token"` when a token was presented |
| `403` | Token lacks the action on that Collection (`AdminDataActionNotGranted`), or a client-supplied id on create (`JsonApiClientIdNotSupported`) |
| `404` | Unknown resource type (`AdminDataResourceTypeNotFound`) or record (`AdminDataRecordNotFound`) |
| `405` | Method selects no enabled operation, including `HEAD` and `PUT` (`Allow` lists the methods the current registration enables) |
| `406` | Unacceptable `Accept` header |
| `409` | Type or id mismatch between URL and body (`JsonApiResourceTypeMismatch`, `JsonApiResourceIdMismatch`), or a stale version (`AdminDataVersionConflict`) |
| `415` | Unsupported request `Content-Type` |
| `422` | Undeclared, read-only, or invalid attribute values |

### Audit logging

Every attempted mutation is logged with the token id (`principal`), resource
type and id, action, request id, and outcome: `admin data mutation succeeded`
at info, or `admin data mutation failed` at warn with the HTTP status and
error code. Failures include rejected authentication, denied grants, invalid
requests, and unexpected errors passed onward to the router. The principal is
null when authentication did not succeed. Bearer secrets and request payloads
are never logged. This is operational logging, not a transactional audit ledger:
a crash between the write and the log line loses the entry.

## Files

Resource type `files` exposes the `File` Collection with `list`, `get`,
`create`, `update`, and `delete` enabled.

| Attribute | Read | Create | Update |
| --- | --- | --- | --- |
| `title` | Yes | Required (string or null, ≤ 200) | Yes |
| `description` | Yes | Required (string or null, ≤ 2000) | Yes |
| `isPublished` | Yes | Required (boolean) | Yes |
| `originalUploadedAt` | Yes | Server-assigned | No |
| `content` | Yes | Required (complete object) | Yes, replaced whole |

`content` is a reference to bytes that already exist in file storage. It must
have exactly these six members; any other member is `422`:

```json
{
    "key": "files/…",
    "filename": "logo.png",
    "contentType": "image/png",
    "etag": "…",
    "generation": "3d6f…-uuid",
    "length": 1024
}
```

Lists are newest-first by `originalUploadedAt`. For files created through
this API, `originalUploadedAt` is the record creation time.

### Examples

These use a token created in the admin panel at **Admin Data API Tokens**
with every `files` action granted. Copy the token from the creation page; it
is not shown again.

```bash
export KIXX_URL=https://example.com
export KIXX_DATA_TOKEN=kxadt_...

# What can this token do?
curl -s "$KIXX_URL/admin-data-api/v1/" \
  -H "Authorization: Bearer $KIXX_DATA_TOKEN"

# Newest Files first, ten at a time; follow links.next for the next page.
curl -s "$KIXX_URL/admin-data-api/v1/files?page%5Bsize%5D=10" \
  -H "Authorization: Bearer $KIXX_DATA_TOKEN"

# Read one File, including the content reference and meta.version.
curl -s "$KIXX_URL/admin-data-api/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $KIXX_DATA_TOKEN"
```

Create a second record that points at an existing File's bytes, using the
`content` object copied from that File:

```bash
curl -s -X POST "$KIXX_URL/admin-data-api/v1/files" \
  -H "Authorization: Bearer $KIXX_DATA_TOKEN" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "files",
      "attributes": {
        "title": "Logo (press kit)",
        "description": null,
        "isPublished": false,
        "content": {
          "key": "5b0c.../9e1d...",
          "filename": "logo.png",
          "contentType": "image/png",
          "etag": "...",
          "generation": "9e1d...",
          "length": 1024
        }
      }
    }
  }'
```

Update the title, sending the version you last read. A `409` means someone
else changed the record; read it again before retrying:

```bash
curl -s -X PATCH "$KIXX_URL/admin-data-api/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $KIXX_DATA_TOKEN" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{ "data": { "type": "files", "id": "'"$FILE_ID"'", "attributes": { "title": "New title" }, "meta": { "version": 3 } } }'
```

Delete the record (never its bytes) at the version you last read:

```bash
curl -s -X DELETE "$KIXX_URL/admin-data-api/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $KIXX_DATA_TOKEN" \
  -H "Kixx-Expected-Version: 4"
```

### Record-only contract and its limits

This resource edits File **records** only:

- There are no upload, download, or byte replacement endpoints. A create must
  supply an existing content reference, for example one copied from a file
  uploaded in the admin panel.
- A content reference is validated for **shape, not existence**. The API does
  not check that the object exists or take ownership of it.
- Updating `content` or deleting a File never deletes or modifies bytes.
  Detaching a reference can leave unused bytes behind.
- Deleting a File is allowed even when it is published. This deliberately
  bypasses the admin panel's publication guard.
- Duplicating a reference across records is not tracked. The admin panel's
  file workflows delete the bytes a record owns, so deleting or replacing one
  record there can leave another record's reference dangling.
- Deleting the admin-panel File that uploaded the bytes deletes those bytes,
  even if API-created records still reference them. Delete or repoint those
  records first.
- Content references are internal storage details. They are returned to any
  token granted access to `File`; treat such tokens as administrative.

### Verification

`test/end-to-end/300-admin-data-api/` exercises this contract against a
running target: tokens created and revoked through the admin panel, scoped
grants, every File operation, stale versions and two concurrent writers, and
byte checks after every repoint and delete. The deterministic race in which a
write lands between load and persist is covered by the unit tests in
`test/unit-tests/app/presentation/request-handlers/admin-data-api/`, which also
prove that no API request reaches the file object store.

## Adding a resource

Register a Collection by adding a registration object to
`src/app/admin-data-api/resources/` and listing it in
`src/app/admin-data-api/mod.js`. The registry validates and freezes every
registration at import, and `app.initialize()` checks each against its
Collection; any mismatch is a programmer error that fails boot.

```javascript
export default {
    type: 'widgets',                 // public JSON:API type: lowercase, hyphenated
    collection: 'Widget',            // registered Collection name: PascalCase
    description: 'What the records are, and what direct edits bypass.',
    attributes: {                    // the complete read projection
        name: { description: 'Widget name.', schema: { type: 'string' } },
    },
    operations: {                    // present = enabled; omit to disable
        list: {
            sorts: [
                // name is the JSON:API sort value; first is the default.
                // index optionally names one of the Collection's INDEXES.
                { name: '-createdAt', description: 'Newest first.', descending: true },
            ],
        },
        get: {},
        create: {
            attributes: [ 'name' ],  // writable on create
            required: [ 'name' ],    // subset of attributes
            // Optional: persist(context, collection, attributes) => Promise<Record>.
            // Defaults to collection.create(context, attributes).
        },
        update: { attributes: [ 'name' ] },
        delete: {},
    },
};
```

Rules the registry enforces:

- Types and Collections are unique; unknown keys anywhere are rejected.
- Attribute names are camelCase and may not be server-owned names (`id`,
  `type`, `version`, `sortKey`, `createdAt`, `updatedAt`, `meta`, `links`,
  `relationships`). Each attribute needs a description and a JSON schema
  fragment for discovery. Record schemas describe; `Record#validate()` and the
  registration enforce.
- Every attribute must exist in the Collection's Record schema, every enabled
  operation needs its Collection method, and every sort index must be declared
  in the Collection's `INDEXES`.
- Write attribute lists name declared attributes only; server-owned values
  belong in a `persist` hook or the Collection.

Exposing a Collection is a security decision: any token granted on it can read
every declared attribute of every record.
