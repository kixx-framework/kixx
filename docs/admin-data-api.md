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

> **Implementation status.** The resource registration contract, the
> permission model, and the File registration exist
> (`src/app/admin-data-api/`, `src/app/permissions/admin-data-api.js`). Token
> minting, the admin-panel token pages, and the HTTP endpoints are delivered by
> later tasks of `agents/plans/admin-data-api.md`; the protocol sections below
> are the contract those tasks implement.

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
`WWW-Authenticate: Bearer` challenge.

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

Request bodies must use `Content-Type: application/vnd.api+json` without media
type parameters other than those JSON:API allows; anything else is `415`.
Responses use `application/vnd.api+json`. An `Accept` header that lists the
JSON:API media type only with unsupported parameters is `406`.

Responses are `Cache-Control: private, no-store`.

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
counts are not supported, so `filter[...]` and any other parameter is `400`.
When more results exist, `links.next` is a complete URL preserving `sort`,
`page[size]`, and `fields`. Cursors are signed; a tampered cursor, or one used
with a different sort, is `400`.

### Errors

Errors use JSON:API error documents with a `status`, `code`, `title`, and,
where applicable, `source.pointer` (body members, e.g.
`/data/attributes/title`), `source.parameter` (query parameters), or
`source.header`. Internal details are never included.

| Status | When |
| --- | --- |
| `400` | Malformed JSON or document, missing/invalid version, invalid query parameter, sort, fieldset, page size, or cursor |
| `401` | Missing or invalid bearer token (`WWW-Authenticate: Bearer`) |
| `403` | Token lacks the action on that Collection, or a client-supplied id on create |
| `404` | Unknown resource type or record |
| `405` | Operation not enabled for the resource (`Allow` lists enabled methods) |
| `406` | Unacceptable `Accept` header |
| `409` | Type or id mismatch between URL and body, or a stale version |
| `415` | Unsupported request `Content-Type` |
| `422` | Undeclared, read-only, or invalid attribute values |

### Audit logging

Every mutation is logged with the token id, resource type and id, action,
request id, and outcome. Bearer secrets and request payloads are never logged.
This is operational logging, not a transactional audit ledger.

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

`content` is a reference to bytes that already exist in file storage:

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
- Content references are internal storage details. They are returned to any
  token granted access to `File`; treat such tokens as administrative.

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
