/**
 * ObjectStoreInterface — the contract for the object/blob store. The
 * implementation changes based on the platform (Cloudflare R2, Node.js
 * filesystem, AWS S3) but the interface stays consistent so
 * application code remains runtime-agnostic.
 *
 * Unlike the key/value store, this is a blob store, not a cache. The defining
 * differences are streaming bodies, first-class per-object metadata, prefix
 * listing, and strong read-after-write consistency. The contract is scoped to
 * the portable intersection of Cloudflare R2 and AWS S3, constrained so the
 * Node.js filesystem adapter can faithfully emulate every method.
 *
 * ## Buckets
 * Every method takes a `bucket` name as its first storage argument; a single
 * store instance fronts multiple buckets. Buckets are a preconfigured
 * allow-list — they are never provisioned at runtime, because a Cloudflare
 * Worker cannot create an R2 bucket dynamically (bindings are declared at deploy
 * time). The store SELECTS among configured buckets; it does not create them.
 * - Cloudflare resolves `bucket name -> R2 binding` from configuration.
 * - Node.js resolves `bucket name -> subdirectory` under the configured root.
 *
 * An unknown bucket name is a configuration/programmer error and MUST throw an
 * `AssertionError` on every adapter.
 *
 * ## Keys
 * - A `key` MUST be a non-empty string of at most 1024 bytes (the R2/S3 limit).
 * - A `key` MAY contain `/` to express logical hierarchy.
 * - A `key` MUST NOT contain control characters, a leading `/`, or any path
 *   segment equal to `"."` or `".."`. These rules let a key map safely onto a
 *   filesystem path without traversal on the Node.js adapter.
 *
 * ## Bodies and streaming
 * Read and write bodies are Web `ReadableStream`s at the interface boundary on
 * every runtime, so large objects are handled without buffering them in memory.
 * - `put()` accepts a body of `ReadableStream | ArrayBuffer | ArrayBufferView |
 *   string | Blob`. The body MUST be non-null. A stream is one-shot.
 * - `get()` returns an `ObjectBody` whose `body` is a Web `ReadableStream`.
 *
 * ## Metadata
 * Object metadata is first-class, unlike the key/value store which records none:
 * `contentType`, `contentLength`, `etag`, `uploaded`, and `customMetadata`.
 * - `contentLength` is computed during the write when the body is a stream; for
 *   sized inputs it is taken directly.
 * - `etag` is an OPAQUE validator. The contract does not promise MD5 semantics or
 *   cross-adapter etag equality: the Node.js adapter computes a strong content
 *   hash at write time, while R2 supplies its own etag.
 * - `uploaded` is a `Date` recording the last successful write.
 * - `customMetadata` is an optional map of string keys to string values.
 *
 * ## No expiration
 * The object store has no TTL/expiry options. Object stores expire data through
 * bucket lifecycle rules, not per-`put` options, and a plain filesystem cannot
 * honor a per-object TTL without a reaper. This is a deliberate divergence from
 * the key/value cache store.
 *
 * ## Consistency
 * The contract guarantees STRONG read-after-write consistency for create,
 * overwrite, and delete: a read issued after a successful write observes the new
 * state. This holds on R2, on S3 (since 2020), and on the local filesystem, so it
 * is a safe portable promise — and a deliberate strengthening over the key/value
 * store's eventual-consistency floor.
 *
 * ## Absent objects
 * `get()` and `head()` resolve to `null` when the object does not exist; absence
 * is an expected outcome, not an error. `delete()` of an absent key is a
 * successful no-op and does not report whether the key previously existed.
 *
 * ## Listing
 * `list()` returns a keyset-paginated page of objects ordered lexicographically
 * by key, with optional `prefix` filtering and `delimiter` grouping. Without
 * `include`, each listed object is guaranteed to carry `key`, `contentLength`,
 * `etag`, and `uploaded`; `include` adds `contentType` and/or `customMetadata`.
 * Callers MUST determine completion via the `truncated` flag, never by comparing
 * the result count to `limit`. Cursors are opaque and are only valid when reused
 * with the same bucket, prefix, delimiter, and sort as the call that produced
 * them; they are not portable across adapters.
 *
 * ## Errors
 * - Invalid arguments (bad key, bad bucket name, unknown/unconfigured bucket,
 *   wrong body type) throw `AssertionError`.
 * - Missing binding or missing configuration throws `AssertionError`.
 * - Transient backend failures (an R2 call failure, a filesystem I/O error) are
 *   wrapped and rethrown as `OperationalError` with the original error preserved
 *   as `cause`.
 *
 * ## Construction
 * Construction MUST accept an options object containing a `logger` and MUST throw
 * when the logger is missing. Implementations create a child logger for their own
 * diagnostics.
 *
 * ## Context pass-through
 * Every method receives a request or execution `context` as its first argument.
 * Runtime adapters use it according to their platform:
 * - Cloudflare adapters resolve the per-bucket R2 binding from `context.env` on
 *   every call, using the bucket allow-list in
 *   `context.config.env.OBJECT_STORE.buckets`.
 * - Node.js adapters resolve the object root from
 *   `context.config.env.OBJECT_STORE.path` via `context.config.resolveFilepath()`
 *   on first use, then hold it fixed for the store's lifetime.
 *
 * ## Runtime adapters
 * @see ObjectStore in ../../plugins/cloudflare-object-store/lib/object-store.js for the Cloudflare R2 implementation
 * @see ObjectStore in ../../plugins/node-object-store/lib/object-store.js for the Node.js filesystem implementation
 */

/**
 * A non-null value accepted as an object body on write.
 *
 * @typedef {(ReadableStream|ArrayBuffer|ArrayBufferView|string|Blob)} ObjectBodyInput
 */

/**
 * Metadata describing a stored object. Returned by `put()` and `head()`.
 *
 * @typedef {Object} ObjectMeta
 * @property {string} key - The object's key.
 * @property {(string|undefined)} contentType - The stored content type, when one was set.
 * @property {number} contentLength - Size of the object body in bytes.
 * @property {string} etag - Opaque cache validator for the stored bytes.
 * @property {Date} uploaded - Timestamp of the last successful write.
 * @property {(Object<string,string>|undefined)} customMetadata - User-defined metadata, when present.
 */

/**
 * An object's metadata combined with its body. Returned by `get()`.
 *
 * @typedef {Object} ObjectBody
 * @property {ReadableStream} body - The object body as a Web ReadableStream.
 * @property {string} key - The object's key.
 * @property {(string|undefined)} contentType - The stored content type, when one was set.
 * @property {number} contentLength - Size of the object body in bytes.
 * @property {string} etag - Opaque cache validator for the stored bytes.
 * @property {Date} uploaded - Timestamp of the last successful write.
 * @property {(Object<string,string>|undefined)} customMetadata - User-defined metadata, when present.
 */

/**
 * A single entry in a `list()` result. `contentType` and `customMetadata` are
 * present only when requested through `ObjectListOptions.include`.
 *
 * @typedef {Object} ObjectListEntry
 * @property {string} key - The object's key.
 * @property {number} contentLength - Size of the object body in bytes.
 * @property {string} etag - Opaque cache validator for the stored bytes.
 * @property {Date} uploaded - Timestamp of the last successful write.
 * @property {(string|undefined)} contentType - Present only when included.
 * @property {(Object<string,string>|undefined)} customMetadata - Present only when included.
 */

/**
 * A keyset-paginated page of objects.
 *
 * @typedef {Object} ObjectList
 * @property {Array<ObjectListEntry>} objects - Listed objects, ordered lexicographically by key.
 * @property {boolean} truncated - True when more results remain for this query.
 * @property {(string|undefined)} cursor - Opaque resume token; present only when `truncated` is true.
 * @property {Array<string>} delimitedPrefixes - Common prefixes collapsed by `delimiter`, when one is supplied.
 */

/**
 * Options for a `put()` call.
 *
 * @typedef {Object} ObjectPutOptions
 * @property {string} [contentType] - Content type to store with the object.
 * @property {Object<string,string>} [customMetadata] - User-defined string metadata to store with the object.
 */

/**
 * Options for a `list()` call.
 *
 * @typedef {Object} ObjectListOptions
 * @property {string} [prefix] - Restrict results to keys beginning with this prefix.
 * @property {string} [cursor] - Opaque token from a previous truncated page; resumes listing.
 * @property {number} [limit=1000] - Maximum number of entries to return (objects plus delimited prefixes), capped at 1000.
 * @property {string} [delimiter] - Group keys sharing a prefix up to this delimiter into `delimitedPrefixes`.
 * @property {Array<string>} [include] - Subset of `['contentType','customMetadata']` to populate on each entry.
 */

/**
 * Object/blob store.
 *
 * @typedef {Object} ObjectStoreInterface
 *
 * @property {function(Object, string, string, ObjectBodyInput, ObjectPutOptions=): Promise<ObjectMeta>} put
 *   Stores `body` under `bucket`/`key`, creating or overwriting any existing
 *   object. Resolves with the resulting `ObjectMeta` (including `etag` and
 *   `contentLength`) so the caller does not need a follow-up `head()`.
 *
 * @property {function(Object, string, string): Promise<(ObjectBody|null)>} get
 *   Retrieves the object body and metadata for `bucket`/`key`. Resolves to an
 *   `ObjectBody`, or `null` when the object is absent.
 *
 * @property {function(Object, string, string): Promise<(ObjectMeta|null)>} head
 *   Retrieves only the metadata for `bucket`/`key`, without the body. Resolves to
 *   an `ObjectMeta`, or `null` when the object is absent.
 *
 * @property {function(Object, string, string): Promise<void>} delete
 *   Deletes `bucket`/`key`. Resolves with no value. Deleting an absent key is a
 *   successful no-op and does not report prior existence.
 *
 * @property {function(Object, string, ObjectListOptions=): Promise<ObjectList>} list
 *   Lists objects in `bucket`, ordered lexicographically by key, with optional
 *   prefix filtering, delimiter grouping, and cursor pagination.
 */
