# Collections

This application keeps data persistence behind a small Data Source Layer, using Collections and Records, separate from presentation and domain logic.

- **Collections** - Table and Type data source gateway
- **Records** - Row and Document data source gateway

For application feature code, agents should always work through registered Collections instead of talking directly to storage infrastructure.

## Backing Stores

This application primarily uses:

- **Document Store** - A JSON Document persistence engine with scan, query, and concurrency control capabilities.
- **Key Value Store** - A simple key/value persistence engine which can store JSON, text blobs, and ArrayBuffers. The key/value store is eventually consistent and has no concurrency control.

An application may also implement custom storage engines with custom Collection and Record gateways.

In any case, application code should access stored data through the Gateway pattern; using registered Collections from the RequestContext:

```js
const users = context.getCollection('User');
const user = await users.get(context, userId);
```

## Gateways

By default, there are two Gateway patterns used in Kixx applications:

### Record

- **Document Store Record** - app/collections/base-document-store-record.js - Implements the Row Data Gateway and Data Transfer Object (DTO) patterns for the Document Store
- **Key/Value Store Record** - app/collections/base-key-value-store-record.js - Implements the Data Transfer Object (DTO) patterns for the Key/Value Store

### Collection

- **Document Store Collection** - app/collections/base-document-store-collection.js - Implements the Table Data Gateway and Table Module patterns for the Document Store.
- **Key/Value Store Collection** - app/collections/base-key-value-store-collection.js - Implements the Table Data Gateway and Table Module patterns for the Key Value Store.

The base collection and record classes are intended to be subclassed for specific application domains.

An application may also implement custom custom Collection and Record gateways for custom storage engines with do not subclass these base classes.

### Document Store and Key Value Store Types

Objects in the document store must have a `type`. By convention, types use PascalCase like `"Cat"`, `"User"`, or `"Account"`. Each Collection subclass must be bound to one application-defined type, and every application-defined type should have an associated Collection subclass.

The Collection API scopes all operations to its `TYPE`. When a document is created or put through a Collection, the Collection sets `type` automatically.

### Defining a Collection

All application Collections should be registered from the app's `register(context)` lifecycle function in app/app.js, after their backing store service has been created. Collections and their paired Record subclasses should be defined in `app/collections/`.

Each Collection subclass should be paired with a Record subclass. The Record subclass holds the document schema (`static schema`), implements `validate()` to enforce invariants before writes, and exposes domain-specific attribute getters. A minimal pair for the Document Store looks like this:

In app/collections/user-record.js:

```js
import Record from './base-document-store-record.js';
import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../kixx/errors/mod.js';

class UserRecord extends Record {
    static schema = {
        type: 'object',
        properties: {
            username: {
                type: 'string',
                description: 'Unique username used as the document id',
            },
            email_address: {
                type: 'string',
                format: 'email',
                description: 'Email address used to contact the user',
            },
        },
        required: [ 'username', 'email_address' ],
    };

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

export default UserRecord;
```

In app/collections/user-collection.js:

```js
import Collection from './base-document-store-collection.js';
import UserRecord from './user-record.js';

export const USER_EMAIL_ADDRESS_INDEX = 'user_email_address';

export default class UserCollection extends Collection {
    static TYPE = 'User';
    static Record = UserRecord;

    // Secondary index definitions owned by this collection (see "Document Store
    // Secondary Indexes" below). app/app.js collects these for registration.
    static INDEXES = [
        { name: USER_EMAIL_ADDRESS_INDEX, jsonPath: '$.email_address' },
    ];

    generateUniqueId(attributes) {
        return attributes.username;
    }

    generateSortKey(doc) {
        return doc?.email_address;
    }

    async findByEmailAddress(context, emailAddress) {
        const result = await this.query(context, {
            index: USER_EMAIL_ADDRESS_INDEX,
            equalTo: emailAddress,
            limit: 1,
        });
        return result.items[0] || null;
    }
}
```

Then, in app/app.js:

```js
export function register(context) {
    const documentStore = new DocumentStore();
    context.registerService('DocumentStore', documentStore);
    context.registerCollection('User', new UserCollection({ db: documentStore }));
}
```

### Custom Collection Helpers

Add application-specific read and write helpers to Collection subclasses when a workflow needs a named lookup or mutation. This keeps index names, query bounds, pagination defaults, key formats, and result normalization inside the data source layer instead of spreading those details through domain or presentation code.

Callers then depend on the business-shaped helper instead of the storage-shaped index contract:

```js
const users = context.getCollection('User');
const user = await users.findByEmailAddress(context, emailAddress);
```

### Document Store Collections: Writing

Document Store Collections expose four ways to write a document. Choose based on your concurrency requirements:

- **`create(context, input)`** — Inserts a new document. Throws `DocumentAlreadyExistsError` if a document already exists for the same `id`. Use this when the document must not already exist (e.g. a sign-up flow where a duplicate email means an error).
- **`put(context, input)`** — Creates or overwrites a document without optimistic concurrency control. Use this for seeding, importing, or any case where you hold the canonical state and don't need to guard against concurrent writes.
- **`update(context, dto)`** — Replaces an existing document only when the stored version matches `dto.version`. Throws `DocumentNotFoundError` when the document is absent and `VersionConflictError` when the version doesn't match. Use this for all user-initiated edits where a concurrent write could corrupt data.
- **`updateWithRetry(context, dto, callback, options)`** — Tries `update()` once, then handles `VersionConflictError` by refetching the latest record, passing it to `callback(latest, { attempt, conflict })`, and retrying the returned or mutated record. Use this for recomputable mutations where automatic merge semantics are safe, such as nonce rotation, counters, timestamps, or similar server-owned values. Do not use it when the caller needs to see and resolve a conflicting user edit. Because `updateWithRetry()` absorbs `VersionConflictError` internally, callers do not catch it. Instead it throws `RetryLimitExceededError` when conflicts continue past `retryLimit`, and `DocumentNotFoundError` if the document is deleted between a conflict and the refetch. `RetryLimitExceededError` carries `name`/`code` of `'RetryLimitExceededError'` plus `type`, `id`, and `retryLimit` properties.

All write methods call `dto.validate()` before persisting. A `ValidationError` thrown from `validate()` propagates to the caller without touching the store.

`create()` and `put()` accept either a plain attributes object or a Record instance. When given a plain object, the Collection normalizes it: strips `type` from stored attributes, preserves a non-empty `input.id` when provided, otherwise calls `generateUniqueId(attributes)` to create the document id, strips `id` from stored attributes, and wraps the result in the configured Record class via `Record.forWrite()`.

`update()` and `updateWithRetry()` require a Record instance — they use the instance's `version` for optimistic concurrency and run the subclass `validate()`. Passing a plain object to `update()` throws an `AssertionError`.

`updateWithRetry()` defaults to three retry attempts after the first conflict; pass `{ retryLimit: 0 }` to disable refetch retries.

### Document Store Collections: Reading and Listing

- **`get(context, id)`** — Retrieves one document by id. Returns `null` when absent.
- **`scan(context, options)`** — Returns a keyset-paginated page of documents ordered by their primary sort key. Returns `{ items, cursor }`. Pass `cursor` back on subsequent calls to page through results. Options: `descending`, `limit` (default 100), `cursor`, `equalTo`, `greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo`. `equalTo` is mutually exclusive with range bounds and throws when combined with them.
- **`query(context, options)`** — Returns a keyset-paginated page of documents ordered by a named secondary index. Requires `options.index`. Returns `{ items, cursor }`. Accepts the same filter and pagination options as `scan()`. The index must be configured in `DOCUMENT_STORE_INDEXES` in `app/app.js` before calling.

`scan()` uses the primary `sortKey` field on the document. `query()` uses a separate index keyed by a JSON path into the document's fields. Use `scan()` to list all documents of a type in sort-key order. Use `query()` to look up documents by a non-primary field.

Pagination cursors are opaque. Reuse a cursor only with the same method, document type, index name when querying, sort direction, and range options that produced it. Without range bounds that exclude them, documents with missing or `null` sort or index values remain in the result set: they sort first in ascending order and last in descending order.

### Document Store Collections: ID Generation and Sort Keys

`BaseDocumentStoreCollection#generateUniqueId(attributes)` is the canonical hook for creating document ids, including derived IDs such as usernames, slugs, or content hashes. Override `generateUniqueId` on the Collection subclass when a document type needs a stable id derived from attributes, a counter-backed id, an injected id service, or any other non-default id strategy. The default `generateUniqueId` returns `crypto.randomUUID()`.

Override `generateSortKey(doc)` when the Collection needs a computed sort key. The default passes through `doc.sortKey` when present, or returns `undefined` to omit one. The sort key controls the ordering returned by `scan()` and must be a string that sorts lexicographically in the desired order. `generateSortKey()` must return a string, `null`, or `undefined`; returning any other type throws an `AssertionError` during a write. Range queries in `scan()` are only meaningful when all documents have sort keys.

### Document Store Collections: Deleting

- **`delete(context, id)`** — Deletes one document by id without concurrency control. Returns `true` when a document was deleted, `false` when no document existed.
- **`deleteStrict(context, dto)`** — Deletes a document only when the stored version matches `dto.version`. Requires a Record instance — passing a plain object throws an `AssertionError`. Throws `DocumentNotFoundError` when absent and `VersionConflictError` on a version mismatch.

## Document Store Records

Document Store Collection methods which return document data return one or more `Record` instances. A Record is a mutable DTO wrapping the raw store record. User-defined document fields are held in a private `#attributes` slot — they are **not** accessible as direct properties on the Record instance. Always read and write document fields through the accessor methods.

### Properties

Store metadata properties are enumerable and read-only:

| Property | Type | Description |
|---|---|---|
| `type` | `string` | Document type (e.g. `"User"`) |
| `id` | `string` | Document identifier within the type |
| `version` | `number` | Optimistic concurrency version assigned by the store |
| `createdAt` | `Date` | Creation timestamp |
| `updatedAt` | `Date` | Last-write timestamp |

### Attribute Accessors

```js
record.get('email')             // read one attribute
record.set('email', 'a@b.com') // write one attribute, returns record for chaining
record.merge({ email, name })   // shallow Object.assign into attributes
record.deepMerge({ address })   // deep merge into attributes
```

Do not read or write document fields directly off the Record instance — always use `get()`, `set()`, `merge()`, or `deepMerge()`. Document fields are not top-level properties; `record.email` will always be `undefined`.

### Subclassing Record

Override `static Record` on the Collection subclass to pair it with a custom Record subclass. The Collection will then wrap all returned documents in the custom class. Expose domain-specific getters on the Record subclass by delegating to `this.get()`:

```js
class UserRecord extends Record {
    get fullName() {
        return `${ this.get('firstName') } ${ this.get('lastName') }`;
    }
}

class UserCollection extends Collection {
    static TYPE = 'User';
    static Record = UserRecord;
}
```

### Schema

Put a `static schema` property on the Record subclass to document what attributes the records in the collection will have. The schema is not automatically enforced — enforcement happens in `validate()` — but it provides a reference for readers and agents working on the collection.

```js
class UserRecord extends Record {
    static schema = {
        type: 'object',
        properties: {
            username: {
                type: 'string',
                description: 'Unique username used as the document id',
            },
            email_address: {
                type: 'string',
                format: 'email',
                description: 'Email address used to contact the user',
            },
        },
        required: [ 'username', 'email_address' ],
    };
}
```

### Validation

Override `validate()` on a Record subclass to enforce invariants before a write. The Collection calls `validate()` automatically during `create()`, `put()`, and `update()` — before the document store call — so a `ValidationError` from `validate()` propagates to the caller without touching the store.

```js
validate() {
    const error = new ValidationError('Invalid user record');
    if (!isNonEmptyString(this.get('username'))) {
        error.push('Username is required', 'username');
    }
    if (error.length) {
        throw error;
    }
}
```

The base `validate()` is a no-op. Subclasses throw `ValidationError` from `kixx/errors/mod.js`.

### Serialization

`record.toDocument()` returns a plain object combining attributes with `type` and `id`. This is the document payload sent to the store. `record.toObject()` returns the same but moves store metadata under a `meta` key (`version`, `createdAt`, `updatedAt`), useful for JSON responses.

### Optimistic Concurrency

The `version` field is an integer incremented by the store on every write. Pass a Record returned by a previous `get()`, `scan()`, or `query()` call directly to `update()` or `deleteStrict()` to guard against concurrent writes. If another writer has modified the document in the meantime, `version` will not match and the store throws `VersionConflictError`. Callers must decide whether to retry, merge, or surface the conflict to the user.

Use `updateWithRetry()` only when the merge can be expressed by reapplying a deterministic mutation to the latest stored record:

```js
await users.updateWithRetry(context, user, (latestUser) => {
    latestUser.set('nonce', crypto.randomUUID());
    latestUser.set('nextnonce', crypto.randomUUID());
});
```

## Document Store Secondary Indexes

A secondary index lets `query()` look up documents by a non-primary field. Each index definition requires two fields:

- **`name`** — A lowercase identifier (letters, digits, and underscores only, starting with a letter). Used as the `options.index` value in `query()`.
- **`jsonPath`** — A JSON path beginning with `$.` that points to the field in the stored document to index (e.g. `$.email_address`, `$.profile.role`).

### A Collection Owns Its Index Definitions

The Collection that queries an index also owns that index's definition. Declare a `static INDEXES` array on the Collection subclass, holding the full `{ name, jsonPath }` definition for every index the Collection queries. Export the index name as a named constant so the Collection's own query helpers and any tests can reference it by name.

```js
export const USER_EMAIL_ADDRESS_INDEX = 'user_email_address';

export default class UserCollection extends Collection {
    static TYPE = 'User';
    static Record = UserRecord;

    static INDEXES = [
        { name: USER_EMAIL_ADDRESS_INDEX, jsonPath: '$.email_address' },
    ];

    async getByEmail(context, emailAddress) {
        const { items } = await this.query(context, {
            index: USER_EMAIL_ADDRESS_INDEX,
            equalTo: emailAddress,
            limit: 1,
        });
        return items[0] ?? null;
    }
}
```

Co-locating the definition keeps the three coupled facts together — the index `name`, the `jsonPath` field it indexes, and the query helper that uses it. When a record's field is renamed, the `jsonPath` is updated in the same file as the query, not in a separate registration list.

### Registering Indexes

Indexes are registered in `DOCUMENT_STORE_INDEXES` in `app/app.js` and passed to `documentStore.initialize()`. `app/app.js` collects each Collection's `static INDEXES` rather than hand-maintaining a parallel list of definitions, so adding an index to a Collection automatically registers it.

```js
import UserCollection from './collections/user-collection.js';

const DOCUMENT_STORE_INDEXES = [
    ...UserCollection.INDEXES,
];
```

An index must be registered before `collection.query()` is called with that `options.index` value. Because a Collection declares `static INDEXES` and `app/app.js` spreads it into `DOCUMENT_STORE_INDEXES`, registration follows automatically.

### Prefer Helpers Over Raw Index Names

Wrap queries in custom Collection helpers so callers do not need to know index names or equality-query range patterns. Callers depend on the business-shaped helper:

```js
const users = context.getCollection('User');
const user = await users.getByEmail(context, emailAddress);
```

## Key/Value Store Collections

The Key/Value Store base classes (`base-key-value-store-collection.js` and `base-key-value-store-record.js`) wrap the eventually-consistent Key/Value Store. They are subclassed the same way as the Document Store base classes — set `static TYPE` and optionally `static Record` — but the API is smaller because the Key/Value Store is a flat keyspace with no concurrency control, no secondary indexes, and no sort-key ordering.

The Key/Value Store Collection owns the typed key format and stores each record as a JSON value at the key `${type}_${id}`. Callers never construct keys themselves.

### Key/Value Store Collections: Methods

There are only three methods. There is no `create`, `update`, `updateWithRetry`, `scan`, `query`, or `deleteStrict` — those depend on document-store capabilities the Key/Value Store does not provide.

- **`get(context, id)`** — Retrieves one JSON record by id. Returns `null` when the key is absent or expired. Throws `AssertionError` when `id` is not a non-empty string.
- **`put(context, input, options)`** — Creates or overwrites one JSON record. Accepts a plain attributes object or a Record instance, normalized the same way as the Document Store (`type` and `id` stripped from stored attributes, `input.id` preserved when non-empty, otherwise `generateUniqueId(attributes)`). Calls `validate()` before persisting. `options` carries expiration settings for the underlying store (`ttlSeconds` or `expiresAt`, mutually exclusive); the stored `type` is always forced to `'json'`. Returns the Record DTO that was written — this is the pre-persistence DTO, **not** a refetched record, because the Key/Value Store assigns no version or timestamps.
- **`delete(context, id)`** — Deletes one JSON record by id. Resolves to `undefined`. Throws `AssertionError` when `id` is not a non-empty string.

```js
const sessions = context.getCollection('UserSession');

const session = await sessions.put(context, { id: sessionId, userId }, { ttlSeconds: 86400 });
const loaded = await sessions.get(context, sessionId);
await sessions.delete(context, sessionId);
```

### Key/Value Store Records

A Key/Value Store Record is a mutable DTO with the same attribute accessors as a Document Store Record — `get()`, `set()`, `merge()`, `deepMerge()` — and the same `validate()`, `toDocument()`, and `toObject()` methods. It differs in its metadata:

- The only read-only metadata properties are `type` and `id`. There is **no** `version`, `createdAt`, or `updatedAt`, because the Key/Value Store provides no optimistic concurrency control or store-assigned timestamps.
- `toObject()` returns attributes plus `type` and `id` with no `meta` key.

Subclass the Key/Value Store Record to add a `static schema`, a `validate()` implementation, and domain getters that delegate to `this.get()`, exactly as with the Document Store Record.

## Custom Gateways

The Document Store Record and Document Store Collection base classes are designed specifically for the Document Store. For most Document Store use cases, subclassing them (as described above) is the right approach — add domain methods to a `Record` subclass and add query or mutation helpers to a `Collection` subclass.

When the application needs to interact with a completely different storage system (not the Document Store), write a new gateway class from scratch rather than subclassing `Collection`. A custom gateway can use whatever constructor shape and method signatures fit the storage system, following the same general pattern: register the gateway as an application Collection, hide storage-specific details from callers, and wrap raw results in a DTO before returning them when that storage system has record-like results.
