# Admin API v1

The Admin API provides operator-only JSON endpoints for data migrations and
publishing-token creation, plus a token-authenticated endpoint for redeeming a
one-time admin invite.

The API is mounted at:

```text
/admin-api/v1
```

Examples in this document use `http://localhost:2026`, the default development
server origin.

## Endpoint summary

| Method | Path | Authentication | Required permission | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/admin-api/v1/migrations` | Admin HTTP Basic | `urn:kixx:list` on `urn:kixx:admin:migrations` | List registered migrations and their durable status |
| `POST` | `/admin-api/v1/migrations/:id/run` | Admin HTTP Basic | `urn:kixx:run` on `urn:kixx:admin:migrations` | Run one migration batch |
| `POST` | `/admin-api/v1/users/invite` | Invite bearer token | None | Redeem an invite and create an admin account |
| `POST` | `/admin-api/v1/publishing-api-tokens` | Admin HTTP Basic | `urn:kixx:create` on `urn:kixx:admin:api-tokens:publishing` | Mint a publishing API bearer token |

Every endpoint path accepts an optional trailing slash.

Only the methods shown above are allowed. A different method on a recognized
path returns `405 Method Not Allowed` with an `Allow` header.

## Protocol conventions

### JSON:API media type

Every `POST` body must use the JSON:API media type:

```http
Content-Type: application/vnd.api+json
```

Media-type parameters such as `charset=utf-8` are accepted. A missing or
different media type returns `415 Unsupported Media Type`.

Successful responses also use:

```http
Content-Type: application/vnd.api+json; charset=utf-8
```

The API does not require an `Accept` header.

### Resource documents

Write endpoints accept one JSON:API resource:

```json
{
    "data": {
        "type": "ResourceType",
        "attributes": {}
    }
}
```

Both `data` and `data.attributes` must be objects, and `data.type` must be a
non-empty string. A malformed document returns `400 Bad Request`. A valid
document with the wrong resource type returns `409 Conflict` with code
`JsonApiResourceTypeMismatch`.

Request resource IDs are not used. Attributes not documented for an endpoint
are ignored.

### Error documents

Expected errors use a JSON:API error document:

```json
{
    "errors": [
        {
            "status": "422",
            "code": "VALIDATION_ERROR",
            "title": "ValidationError",
            "detail": "Password must be at least 16 characters",
            "source": "password"
        }
    ]
}
```

`status` is a string. `source` is the form's field identifier for
field-validation errors and may be omitted for other errors. Most identifiers
match the JSON attribute; admin email validation uses `email_address` for the
submitted `emailAddress` attribute. A validation failure can return more than
one error object.

Common failures are:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `BAD_REQUEST_ERROR` | Invalid JSON, malformed JSON:API envelope, or invalid dry-run cursor |
| `401` | `UNAUTHENTICATED_ERROR` | Required credentials are absent or malformed |
| `401` | `InvalidCredentials` | Admin email or password was rejected |
| `403` | `FORBIDDEN_ERROR` | Authenticated admin lacks the required permission |
| `404` | `NOT_FOUND_ERROR` | A requested migration ID is not registered |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | Method is not allowed on the recognized path |
| `409` | `JsonApiResourceTypeMismatch` | Request resource type is wrong |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Request `Content-Type` is not JSON:API |
| `422` | `VALIDATION_ERROR` | One or more attributes are invalid |

Endpoint-specific errors are documented with their endpoints. Unexpected
application or persistence failures are not part of the public contract; they
are reported as server failures without exposing internal details.

## Admin authentication and authorization

The migration and publishing-token endpoints authenticate every request using
HTTP Basic credentials. The username is an admin email address and the password
is the admin account password:

```http
Authorization: Basic <base64(email:password)>
```

The email lookup is case-insensitive after trimming. Passwords are preserved
exactly and may contain colons; the first decoded colon separates the username
from the password. Missing, malformed, empty-username, and empty-password Basic
credentials return `401`. An unknown email and an incorrect password return the
same `InvalidCredentials` response to avoid account enumeration.

After authentication, permissions are derived from the account's stored role
IDs for the current request:

| Role | List/run migrations | Create publishing tokens |
| --- | --- | --- |
| `root-admin` | Yes | Yes |
| `developer` | Yes | Yes |
| `admin` | No | No |
| `editor` | No | No |

The role registry is the authority for these capabilities. Unknown stored role
IDs grant no permissions.

For protected write endpoints, authentication and authorization run before the
body's media type, JSON shape, and attributes are checked. The invite endpoint
checks the media type first, then the Bearer credential, JSON shape, invite
state, and account attributes, in that order.

## List migrations

```http
GET /admin-api/v1/migrations
```

Returns every migration registered in the deployed build, in registry order.
The registry controls visibility: retired or malformed ledger records that are
not in the current registry are not returned.

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": [
        {
            "type": "Migration",
            "id": "2026-07-17-example-noop",
            "attributes": {
                "description": "Verify the remote migration workflow without reading or changing application data.",
                "status": "pending",
                "stats": null,
                "batchCount": null,
                "startedBy": null,
                "startedAt": null,
                "completedAt": null,
                "error": null
            }
        }
    ]
}
```

Migration attributes are:

| Attribute | Type | Meaning |
| --- | --- | --- |
| `description` | string | Operator-facing description from the deployed registry |
| `status` | `pending`, `running`, `applied`, or `failed` | Current lifecycle state |
| `stats` | object or `null` | Finite numeric counters accumulated across committed real batches |
| `batchCount` | integer or `null` | Number of successfully committed real batches |
| `startedBy` | string or `null` | Admin ID that started the current real run |
| `startedAt` | ISO date-time string or `null` | Time the current real run began |
| `completedAt` | ISO date-time string or `null` | Time the run applied or failed |
| `error` | string or `null` | Client-safe failure message for a failed run |

`pending` is synthesized when a registered migration has no ledger record. Its
nullable fields are all `null`. Dry runs never create or update ledger records,
so they never change this endpoint's output.

### Example

```bash
curl --user 'admin@example.com:password' \
    http://localhost:2026/admin-api/v1/migrations
```

## Run a migration batch

```http
POST /admin-api/v1/migrations/:id/run
Content-Type: application/vnd.api+json
```

One request runs exactly one bounded batch. A client must issue subsequent
requests until the response has `done: true`.

The `:id` path segment is the permanent migration ID from the list endpoint.
An unregistered ID returns `404 Not Found`.

### Request

The required resource type is `MigrationRun`.

```json
{
    "data": {
        "type": "MigrationRun",
        "attributes": {
            "dryRun": false,
            "force": false,
            "cursor": null
        }
    }
}
```

All attributes are optional:

| Attribute | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dryRun` | boolean | `false` | Preview one batch without application-data, external, or ledger mutations |
| `force` | boolean | `false` | Restart an applied or failed real run from the beginning |
| `cursor` | non-empty string or `null` | `null` | Opaque caller-owned cursor for a dry run |

`dryRun` and `force` cannot both be `true`. The cursor is ignored for a real
run because real progress is loaded from the durable ledger. Do not parse or
modify a dry-run cursor; return it unchanged in the next dry-run request.

An empty attributes object starts or resumes a real run:

```json
{
    "data": {
        "type": "MigrationRun",
        "attributes": {}
    }
}
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "MigrationRun",
        "id": "2026-07-17-example-noop",
        "attributes": {
            "done": true,
            "cursor": null,
            "stats": {
                "scanned": 0
            },
            "status": "applied",
            "dryRun": false
        }
    }
}
```

| Attribute | Type | Meaning |
| --- | --- | --- |
| `done` | boolean | Whether this migration run has completed |
| `cursor` | non-empty string or `null` | Next dry-run cursor, or the stored real-run cursor; `null` on completion |
| `stats` | object | Dry-run counters for this batch, or accumulated counters for a real run |
| `status` | `dry-run`, `running`, or `applied` | Outcome after this batch |
| `dryRun` | boolean | Whether this was a dry-run batch |

### Real-run lifecycle

- The first real request creates a `running` ledger record before invoking the
  migration.
- A successful non-terminal batch commits its cursor, accumulates its numeric
  stats, increments `batchCount`, and remains `running`.
- A successful terminal batch stores a null cursor and becomes `applied`.
- A `running` migration resumes at its last successfully committed cursor.
- A `failed` migration resumes at its last successfully committed cursor when
  `force` is false. Its accumulated stats and original start identity/time are
  preserved.
- `force: true` resets an `applied` or `failed` migration to a fresh run. Its
  cursor, stats, batch count, start identity, and timestamps are reset.
- Running an already-applied migration without force returns `409` with code
  `MigrationAlreadyAppliedError`.

Real batches use optimistic concurrency. When another operator advances the
same migration first, the request returns `409` with code
`MigrationConcurrencyError`; reload status and retry. If a real run's stored
cursor is invalid, the ledger becomes failed and the request returns `409` with
code `MigrationCursorConflictError`; restart it with `force: true`.

If a migration batch fails, failure bookkeeping is best effort. The ledger
preserves the last committed cursor and stats and normally becomes `failed` with
a safe error message. Application writes and the ledger commit are not atomic,
so migration implementations must be idempotent in case a batch is replayed.

### Dry-run lifecycle

A dry run performs the migration's normal reads, selection, skip logic, and
counting, but performs no application-data writes, external mutations, or
ledger writes. Its response always has `status: "dry-run"`.

Dry-run progress belongs entirely to the caller. Begin with `cursor: null`; if
`done` is false, submit the returned cursor to the next dry-run request. An
invalid dry-run cursor returns `400 Bad Request`.

### Examples

Run one real batch:

```bash
curl --user 'admin@example.com:password' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"MigrationRun","attributes":{}}}' \
    http://localhost:2026/admin-api/v1/migrations/2026-07-17-example-noop/run
```

Run the first dry-run batch:

```bash
curl --user 'admin@example.com:password' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"MigrationRun","attributes":{"dryRun":true}}}' \
    http://localhost:2026/admin-api/v1/migrations/2026-07-17-example-noop/run
```

## Accept an admin invite

```http
POST /admin-api/v1/users/invite
Authorization: Bearer <invite-token>
Content-Type: application/vnd.api+json
```

This endpoint does not accept admin Basic credentials. The one-time invite
bearer token is the credential.

### Request

The required resource type is `AdminUser`.

```json
{
    "data": {
        "type": "AdminUser",
        "attributes": {
            "emailAddress": "new-admin@example.com",
            "password": "at-least-16-characters"
        }
    }
}
```

| Attribute | Requirements |
| --- | --- |
| `emailAddress` | Required string in a basic email-address shape; trimmed and lowercased before storage |
| `password` | Required string, 16 to 256 characters; preserved exactly as submitted |

The invite is resolved before account-field validation. An absent or malformed
Bearer header returns `401`. An unknown, expired, revoked, already-used, or
concurrently redeemed token returns the same `403` response with code
`InvalidInvite`, preventing clients from probing invite state.

Stored invites grant their configured roles. The deployment's
`ADMIN_BOOTSTRAP_TOKEN`, when configured and unused, grants `root-admin`. The
bootstrap token is also single-use: its consumption is recorded even while the
environment value remains configured.

### Response

The endpoint creates the account but does not create a login session.

```http
HTTP/1.1 201 Created
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "AdminUser",
        "id": "<admin-user-id>",
        "attributes": {
            "emailAddress": "new-admin@example.com",
            "userCreationDate": "2026-08-27T12:00:00.000Z"
        }
    }
}
```

The response never includes the password, password hash, invite token, or
assigned roles.

### Conflict and consumption behavior

- If the email already exists when checked, the response is `409` with code
  `NewUserConflictError`; the invite is not consumed.
- The invite is consumed before the new user record is written. This guarantees
  that one token cannot create two admins under concurrent redemption.
- If another signup claims the email between the initial check and user write,
  the response is `409` with code `InviteSpentInEmailRace`; the invite has been
  consumed and a new invite is required.
- If the account write fails after invite consumption, the invite remains
  consumed. The system intentionally does not reopen it because rollback could
  allow one token to create multiple accounts.

### Example

```bash
curl \
    --header 'Authorization: Bearer invite-secret' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"AdminUser","attributes":{"emailAddress":"new-admin@example.com","password":"at-least-16-characters"}}}' \
    http://localhost:2026/admin-api/v1/users/invite
```

## Create a publishing API token

```http
POST /admin-api/v1/publishing-api-tokens
Content-Type: application/vnd.api+json
```

Mints a bearer token for the separate Publishing API. The required resource
type is `PublishingApiToken`.

### Request

```json
{
    "data": {
        "type": "PublishingApiToken",
        "attributes": {
            "roles": ["editor"],
            "timeToLiveSeconds": 2592000,
            "description": "CMS production deploy"
        }
    }
}
```

All attributes are optional:

| Attribute | Type | Default | Requirements |
| --- | --- | --- | --- |
| `roles` | string array | `["editor"]` | One or more publishing-role IDs; currently only `editor` is valid |
| `timeToLiveSeconds` | integer | `2592000` (30 days) | From 1 through `31536000` (365 days), inclusive |
| `description` | string or `null` | `null` | Trimmed; a blank string becomes `null` |

An omitted, null, empty, or non-array `roles` value is normalized to
`["editor"]`. An array containing any other value fails validation. An omitted
or null TTL uses the default.

### Response

```http
HTTP/1.1 201 Created
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "PublishingApiToken",
        "id": "<sha256-token-digest>",
        "attributes": {
            "token": "kxpat_<secret>",
            "roles": ["editor"],
            "description": "CMS production deploy",
            "createdBy": "<admin-user-id>",
            "tokenCreationDate": "2026-08-27T12:00:00.000Z",
            "tokenExpirationDate": "2026-09-26T12:00:00.000Z"
        }
    }
}
```

The plaintext `token` appears only in this response and cannot be retrieved
later. Store it before discarding the response. The persisted record ID and
response `id` are the token's SHA-256 hex digest; plaintext is never persisted.
If the plaintext is lost, mint a replacement.

### Example

```bash
curl --user 'admin@example.com:password' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"PublishingApiToken","attributes":{"description":"CMS production deploy"}}}' \
    http://localhost:2026/admin-api/v1/publishing-api-tokens
```

## Operator workflows

### Safely apply a migration

1. List migrations and select a `pending` or intended `failed` migration.
2. Dry-run batches from a null cursor until `done` is true, carrying each
   returned cursor forward.
3. Review the dry-run stats.
4. Submit real-run batches until `done` is true. Do not send the dry-run cursor;
   the server owns real-run progress.
5. List migrations again and confirm `status: "applied"` and the accumulated
   stats.

Use `force` only to restart a failed migration from the beginning or to
deliberately rerun an applied migration. A migration's data writes must be
idempotent because forced runs and replay after interruption are supported.

### Bootstrap the first admin

1. Configure a strong, secret `ADMIN_BOOTSTRAP_TOKEN` in the deployment.
2. Redeem it once through the invite endpoint.
3. Remove the environment value after the root admin is created. The consumed
   marker prevents reuse even before removal.

### Mint a publishing credential

1. Authenticate as a `root-admin` or `developer`.
2. Choose the shortest practical TTL and an operator-facing description.
3. Create the token and capture its one-time plaintext value.
4. Use that bearer token against the separate `/publishing-api/v1` API.
