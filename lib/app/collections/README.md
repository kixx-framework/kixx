# Collections

The Data Source Layer. It keeps persistence separate from presentation and domain logic.

- **Collections** — Table Data Gateway / Table Module, scoped to one type.
- **Records** — Row Data Gateway / DTO (mutable data object) for one stored item.

Feature code must go through registered Collections, never directly to storage:

```js
const users = context.getCollection('User');
const user = await users.get(context, userId);
```

## Backing Stores

| Store | Collection base | Record base | Notes |
|---|---|---|---|
| Document Store | `base-document-store-collection.js` | `base-document-store-record.js` | JSON documents. Scan, secondary-index query, optimistic concurrency. |
| Key/Value Store | `base-key-value-store-collection.js` | `base-key-value-store-record.js` | JSON at `${type}_${id}`. Eventually consistent. No concurrency control, indexes, or ordering. |
| Object Store | none | none | Blobs (uploaded files). Use a [custom gateway](#custom-gateways). |

Subclass the base classes for each domain type. Other storage systems get custom gateways.

## Defining a Collection

Put each Collection and its paired Record in `app/collections/`. Every application type gets one Collection.

- `static TYPE` is required. Use PascalCase (`"User"`). Document Store types must match `/^[A-Za-z][A-Za-z0-9_]*$/`. The constructor throws `AssertionError` if `TYPE` is not overridden.
- `static Record` pairs the Collection with its Record subclass. All results are wrapped in it.
- Ids are non-empty strings. The Document Store also rejects control characters.
- The Collection sets `type` on every write. Callers never pass it.

`app/collections/user-record.js`:

```js
import Record from './base-document-store-record.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';
import { ValidationError } from '../../kixx/errors/mod.js';

export default class UserRecord extends Record {
    // Documentation only; not enforced. List nullable fields in `required` too
    // ("present but possibly null") and enforce null rules in validate().
    static schema = {
        type: 'object',
        properties: {
            username: { type: 'string', description: 'Unique username; the document id' },
            email_address: { type: 'string', format: 'email' },
        },
        required: [ 'username', 'email_address' ],
    };

    // Domain getters delegate to this.get().
    get emailAddress() {
        return this.get('email_address');
    }

    validate() {
        const error = new ValidationError('Invalid user record');

        if (!isNonEmptyString(this.get('username'))) {
            error.push('Username is required', 'username');
        }
        if (!isNonEmptyString(this.get('email_address'))) {
            error.push('Email address is required', 'email_address');
        }

        if (error.length) {
            throw error;
        }
    }
}
```

`app/collections/user-collection.js`:

```js
import Collection from './base-document-store-collection.js';
import UserRecord from './user-record.js';

export const USER_EMAIL_ADDRESS_INDEX = 'user_email_address';

export default class UserCollection extends Collection {
    static TYPE = 'User';
    static Record = UserRecord;

    static INDEXES = [
        { name: USER_EMAIL_ADDRESS_INDEX, jsonPath: '$.email_address', unique: true },
    ];

    generateUniqueId(attributes) {
        return attributes.username;
    }

    async findByEmailAddress(context, emailAddress) {
        const { items } = await this.query(context, {
            index: USER_EMAIL_ADDRESS_INDEX,
            equalTo: emailAddress,
            limit: 1,
        });
        return items[0] ?? null;
    }
}
```

`app/app.js`, trimmed to this example:

```js
const DOCUMENT_STORE_INDEXES = [
    ...UserCollection.INDEXES,
];

export function register(context) {
    const documentStore = new DocumentStore({ logger: context.logger });
    const keyValueStore = context.getService('KeyValueStore');

    context.registerService('DocumentStore', documentStore);

    context.registerCollection('User', new UserCollection({ db: documentStore }));
    context.registerCollection('UserSession', new UserSessionCollection({ db: keyValueStore }));
}

export function initialize(context) {
    context.getService('DocumentStore').initialize({
        engine: context.getService('DocumentStoreEngine'),
        indexes: DOCUMENT_STORE_INDEXES,
        cursorSigningSecret: context.getEnvString('DOCUMENT_STORE_CURSOR_SIGNING_SECRET', { required: true }),
    });
}
```

Collections are built in `register()`. The `DocumentStore` is unusable until `initialize()` connects its engine, indexes, and cursor secret.

### Custom Helpers

Add named helpers (like `findByEmailAddress`) to the Collection for each lookup or mutation a workflow needs. Index names, query bounds, key formats, and pagination defaults stay inside the Collection. Callers use the helper, not `query()`.

## Document Store Collections

### Writing

| Method | Concurrency | Throws (besides `ValidationError`) |
|---|---|---|
| `create(context, input)` | Must not exist | `DocumentAlreadyExistsError`, `DocumentUniqueIndexViolationError` |
| `put(context, input)` | None; overwrites | `DocumentUniqueIndexViolationError` |
| `update(context, record)` | `record.version` must match | `DocumentNotFoundError`, `VersionConflictError`, `DocumentUniqueIndexViolationError` |
| `updateWithRetry(context, record, callback, options)` | Retries on conflict | `RetryLimitExceededError`, `DocumentNotFoundError`, `DocumentUniqueIndexViolationError` |

- Use `create()` when a duplicate is an error, `put()` for seeding or imports, and `update()` for user edits.
- Every write calls `record.validate()` first. A `ValidationError` never reaches the store.
- `create()` and `put()` accept a plain object or a Record. A plain object is normalized: `type` dropped, a non-empty `id` kept (else `generateUniqueId(attributes)`), `sortKey` moved to Record metadata, then wrapped via `Record.forWrite()`.
- `update()`, `updateWithRetry()`, and `deleteStrict()` require an instance of `this.Record` with a matching type. Otherwise they throw `AssertionError`.

`updateWithRetry()` is for safely recomputable server-owned changes (nonces, counters, timestamps). Do not use it for user edits whose conflicts the user must resolve. On `VersionConflictError` it refetches, calls `callback(latest, { attempt, conflict })`, and retries the returned record (or `latest` when the callback returns `undefined`). `options.retryLimit` defaults to `3`; `0` disables retries. `RetryLimitExceededError` has `type`, `id`, `retryLimit`, and the last conflict as `cause`. Unique index violations are not retried.

```js
await users.updateWithRetry(context, user, (latest) => {
    latest.set('nonce', crypto.randomUUID());
});
```

### Reading

- **`get(context, id)`** — One document, or `null`.
- **`scan(context, options)`** — Page ordered by the primary `sortKey`, or by the store-assigned `createdAt` with `orderBy: 'createdAt'`.
- **`query(context, options)`** — Page ordered by the secondary index named in `options.index`.

`scan()` and `query()` return `{ items, cursor }`. Options:

- `orderBy` — Scan only. `'sortKey'` (default) or `'createdAt'`. Ties are ordered by id.
- `limit` — Positive integer, default `100`.
- `descending` — Defaults to `false`.
- `cursor` — Opaque token from the previous page. `null` or omitted starts at page one. The returned `cursor` is `null` on the last page.
- `equalTo`, or range bounds `greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo`. `equalTo` cannot be combined with range bounds. They apply to the ordering column or index. Under `orderBy: 'createdAt'` they must be exact `Date#toISOString()` strings; anything else throws `AssertionError`, so validate user input first.

Cursors are HMAC-signed by the `DocumentStore` and bound to the method, type, index, ordering column, direction, and range options that produced them. A tampered, foreign, or replayed cursor throws `InvalidCursorError`. `limit` is not bound and may change between pages.

For prefix matches on a sort key or index, spread `sortKeyPrefixRange(prefix)` from `kixx/document-store/document-store.js`. It only covers every match when keys are BMP-only (ASCII, ISO timestamps, etc.). Documents without a key are excluded.

```js
const { items } = await this.query(context, {
    index: ACTIVATION_BUILD_INDEX,
    ...sortKeyPrefixRange(`${ buildId }:`),
});
```

### Deleting

- **`delete(context, id)`** — No concurrency check. Returns `true` if deleted, `false` if absent.
- **`deleteStrict(context, record)`** — Requires matching `record.version`. Throws `DocumentNotFoundError` or `VersionConflictError`.

### IDs and Sort Keys

- **`generateUniqueId(attributes)`** — Defaults to `crypto.randomUUID()`. Override it for derived ids (usernames, slugs, hashes), counters, or id services.
- **`generateSortKey(doc)`** — Defaults to `doc.sortKey` (from Record metadata) or `undefined`. Override it to compute one. It must return a string, `null`, or `undefined`; anything else throws `AssertionError`. Sort keys compare as strings, so format them to sort correctly as text (zero-padded numbers, ISO dates). Range scans by sort key only make sense when every document has one. `orderBy: 'createdAt'` needs no sort key.

### Secondary Indexes

An index definition is `{ name, jsonPath, unique? }`:

- `name` — Lowercase letters, digits, and underscores, starting with a letter; at most 80 characters. Unique across the store.
- `jsonPath` — Starts with `$.` (e.g. `$.email_address`, `$.profile.role`).
- `unique` — Boolean, default `false`. Enforced per `(type, value)`. A violating write throws `DocumentUniqueIndexViolationError` (`indexName` says which index).

The Collection that queries an index owns it. Declare it in `static INDEXES` and export its name as a constant. When adding a new Collection, spread its `INDEXES` into `DOCUMENT_STORE_INDEXES` in `app/app.js`. After that, new entries register automatically. `DocumentStore#initialize()` throws `AssertionError` on an invalid definition. The Administrative Data API also checks `INDEXES` at boot and fails if one of its sorts names an index the Collection does not declare.

## Document Store Records

Fields live in a private slot. `record.email` is always `undefined`. Read and write through:

```js
record.get('email');
record.set('email', 'a@b.com');  // chainable
record.merge({ email, name });   // shallow; AssertionError on non-plain-object
record.deepMerge({ address });   // deep; TypeError on non-plain-object
```

Read-only metadata:

| Property | Type | |
|---|---|---|
| `type` | `string` | Document type |
| `id` | `string` | Id within the type |
| `sortKey` | `string` or `null` | Ordering key |
| `version` | `number` | Optimistic concurrency version |
| `createdAt` | `Date` | |
| `updatedAt` | `Date` | |

- **`validate()`** — A no-op by default. Push every violation into one `ValidationError` with `error.push(message, sourceField)`, then throw once. For lifecycle rules (a status that decides which fields must be set), check field shapes first, then cross-field rules, using the same error.
- **`toDocument()`** — The write shape: attributes plus `type`, `id`, and non-null `sortKey`.
- **`toObject()`** — Attributes plus `type`, `id`, and `meta: { sortKey, version, createdAt, updatedAt }`. Use it for JSON responses.
- **`Record.forWrite({ type, id, sortKey?, attributes })`** — Builds a Record with placeholder metadata, outside a Collection. Useful for running `validate()` early and in unit tests.

## Key/Value Store Collections

Same subclassing pattern (`TYPE`, `Record`, `generateUniqueId`). Only three methods:

- **`get(context, id)`** — Returns a Record, or `null` when absent or expired.
- **`put(context, input, options)`** — Creates or overwrites. Input is normalized like the Document Store (no `sortKey`), and `validate()` runs first. `options` is `{ ttlSeconds }` (integer ≥ 60) or `{ expiresAt }` (future Unix seconds), not both. Returns the pre-write Record. Nothing is refetched.
- **`delete(context, id)`** — Resolves to `undefined`.

`get` and `delete` throw `AssertionError` on an empty id.

```js
const sessions = context.getCollection('UserSession');
await sessions.put(context, { id: sessionId, userId }, { ttlSeconds: 86400 });
```

Key/Value Records have the same accessors, `validate()`, `toDocument()`, and `toObject()`. Their only metadata is `type` and `id`. There is no `version`, timestamps, or `meta` key.

## Custom Gateways

For a storage system other than the Document Store or Key/Value Store, write a gateway class from scratch with whatever constructor and methods fit. Register it as a Collection, hide storage details, and return DTOs when results are record-like.

Example: `FileContentCollection` (`file-content-collection.js`) wraps the Object Store. It owns the bucket, the upload size limit, and the `<fileId>/<generation UUID>` key format.

```js
context.registerCollection('FileContent', new FileContentCollection({
    store: context.getService('ObjectStore'),
    bucket: filesConfig.bucket,
    maxUploadBytes: filesConfig.maxUploadBytes,
}));
```
