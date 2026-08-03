/**
 * KeyValueStoreInterface — the contract for the key/value cache store. The
 * implementation will change based on the platform (Cloudflare KV, Node.js,
 * Deno, AWS, redis/memcached, etc.) but the interface should remain consistent
 * so that application code stays runtime-agnostic.
 *
 * Unlike the document store, this is a cache: a flat keyspace of opaque values
 * with optional expiration and no versioning, indexes, or query/scan. The
 * contract is deliberately scoped to the portable intersection of memcached,
 * redis, and Cloudflare KV — `get`, `put`, and `delete` plus a relative or
 * absolute TTL — so that no method becomes unimplementable on a backing store
 * that a later phase may add.
 *
 * ## No namespace
 * Unlike the Hyperview template and page-data stores, this store has no
 * `namespace` concept. A cache is not build-versioned; it is a single flat
 * keyspace. Callers that need logical grouping prefix their own keys.
 *
 * ## Keys
 * - A `key` MUST be a non-empty string.
 * - A `key` MUST NOT contain control characters and MUST NOT be `"."` or `".."`.
 * - Keys SHOULD be kept within 512 bytes for portability; an adapter MAY reject
 *   keys that exceed its backing store's limit (Cloudflare KV caps keys at 512
 *   bytes; a future memcached adapter would further restrict this to 250 bytes).
 *
 * ## Values and explicit typing
 * The store records no type metadata, so the caller declares a value's encoding
 * explicitly on every read and write via `options.type`. There is no inference.
 * - `'text'` (default): the value is a non-empty string and is stored and
 *   returned as-is.
 * - `'json'`: on write the value MUST be a non-null JSON-serializable value and
 *   the store serializes it; on read the store parses the stored text.
 * - `'arrayBuffer'`: the value is an `ArrayBuffer` or a typed-array view of
 *   binary data, stored and returned as bytes.
 *
 * Read and write `type` symmetry is the caller's responsibility: a value written
 * as `'json'` MUST be read back as `'json'`. A mismatch fails the same way it
 * would against raw Cloudflare KV (for example, JSON-parsing non-JSON text).
 *
 * ## Expiration
 * `put()` accepts at most one of two mutually-exclusive expiry options:
 * - `ttlSeconds`: a positive integer relative time-to-live in seconds.
 * - `expiresAt`: an absolute expiry as a Unix timestamp in seconds, in the future.
 *
 * Supplying both MUST be rejected. When neither is supplied, the entry does not
 * expire.
 *
 * An expiry MUST be at least 60 seconds out, and an adapter MUST reject a
 * shorter one rather than silently clamping it. Like the 512-byte key cap, this
 * floor is the portable intersection rather than any one platform's preference:
 * Cloudflare KV imposes it as a hard limit, so an adapter that accepted a
 * 30-second TTL would let a caller write code that passes on one deploy target
 * and throws on another. Adapters whose backing store has no such floor adopt it
 * anyway, and reject rather than clamp so the caller learns at the call site
 * instead of discovering it as a premature eviction in production.
 *
 * A caller that recomputes an expiry from a stored deadline (rewriting an entry
 * to add to it, for example) MUST therefore treat "less than 60 seconds left" as
 * a case to handle — by deleting the entry or starting a new one — not as a
 * shorter write.
 *
 * ## Edge cache hint on read
 * `get()` accepts an optional `cacheTtl`: a positive integer number of seconds,
 * at least 60, hinting how long Cloudflare may serve a cached read from an edge
 * location before revalidating. This is a Cloudflare-only optimization — other
 * adapters are expected to no-op on it — but every adapter MUST still validate
 * it and reject a value under 60 seconds, for the same portability reason as
 * the expiry floor: code that passes on one adapter must not throw on another.
 *
 * ## Consistency
 * The contract makes no read-after-write consistency guarantee. This is the
 * portable floor: Cloudflare KV is eventually consistent and a write may take up
 * to ~60 seconds to be globally visible. Callers MUST NOT rely on a `put()`
 * being immediately observable by a subsequent `get()` on a different edge.
 *
 * ## delete returns nothing
 * `delete()` resolves to `undefined`, not a boolean. The contract cannot report
 * whether the key previously existed because Cloudflare KV's delete does not
 * surface that information; promising a boolean would be a lie on that adapter.
 *
 * ## Construction
 * Construction MUST accept an options object containing a `logger` and MUST throw
 * when the logger is missing. Implementations create a child logger for their own
 * diagnostics.
 *
 * ## Context pass-through
 * Every read and write method receives a request or execution `context` as its
 * first argument. Runtime adapters use that context according to their platform:
 * - Cloudflare adapters resolve their request-scoped KV binding from
 *   `context.env` on every call.
 * - Node.js adapters receive their local database file location during plugin
 *   registration from immutable application config, and accept `context` for
 *   interface compatibility.
 *
 * Implementations MUST accept the argument so callers can stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design, because their backing
 * stores and access models differ.
 * @see KeyValueStore in ../../plugins/cloudflare-key-value-store/lib/key-value-store.js for the Cloudflare KV implementation
 * @see KeyValueStore in ../../plugins/node-key-value-store/lib/key-value-store.js for the Node.js SQLite implementation
 */

/**
 * The declared encoding of a value on read or write.
 *
 * @typedef {('text'|'json'|'arrayBuffer')} KeyValueType
 */

/**
 * A non-null JSON value accepted by the `'json'` encoding.
 *
 * @typedef {(string|number|boolean|Object|Array)} KeyValueJSONValue
 */

/**
 * Options for a `get()` call.
 *
 * @typedef {Object} KeyValueGetOptions
 * @property {KeyValueType} [type='text'] - How to decode the stored value.
 * @property {number} [cacheTtl] - Cloudflare-only edge cache hint, in seconds
 *   (positive integer, at least 60). Controls how long Cloudflare may serve a
 *   cached read from an edge location before revalidating against the
 *   namespace. Other adapters accept and ignore the value but still enforce
 *   the 60-second floor, so a `get()` proven on one adapter behaves the same
 *   on another.
 */

/**
 * Options for a `put()` call.
 *
 * @typedef {Object} KeyValuePutOptions
 * @property {KeyValueType} [type='text'] - How to encode the supplied value.
 * @property {number} [ttlSeconds] - Relative time-to-live in seconds (positive
 *   integer, at least 60). Mutually exclusive with `expiresAt`.
 * @property {number} [expiresAt] - Absolute expiry as a Unix timestamp in
 *   seconds, at least 60 seconds in the future. Mutually exclusive with
 *   `ttlSeconds`.
 */

/**
 * Key/value cache store.
 *
 * @typedef {Object} KeyValueStoreInterface
 *
 * @property {function(Object, string, KeyValueGetOptions=): Promise<(string|KeyValueJSONValue|ArrayBuffer|null)>} get
 *   Retrieves a value by key, decoded per `options.type`. Resolves to the value,
 *   or `null` when the key is absent or expired. Returns a string for `'text'`,
 *   the parsed value for `'json'`, and an `ArrayBuffer` for `'arrayBuffer'`.
 *
 * @property {function(Object, string, (string|KeyValueJSONValue|ArrayBuffer|ArrayBufferView), KeyValuePutOptions=): Promise<void>} put
 *   Creates or overwrites a value, encoded per `options.type`, with optional
 *   expiration. The `value` MUST be non-null and MUST match the declared `type`.
 *   Resolves with no value.
 *
 * @property {function(Object, string): Promise<void>} delete
 *   Deletes a value by key. Resolves with no value, and does not report whether
 *   the key previously existed.
 */
