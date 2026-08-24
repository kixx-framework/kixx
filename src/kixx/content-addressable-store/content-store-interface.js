/**
 * ContentStoreInterface — the contract for the persistence layer beneath
 * {@link ContentAddressableStore}. The implementation will change based on the
 * platform (Cloudflare KV plus a Durable Object, Node.js, Deno, AWS, etc.) but
 * the interface should remain consistent so that application code stays
 * runtime-agnostic.
 *
 * ## The logical model
 * The store holds two kinds of data with deliberately different rules:
 *
 * - **Blobs** are immutable byte strings addressed by content hash. A hash
 *   always denotes the same bytes, so a blob is write-once and safe to cache
 *   without bound.
 * - **Index closures** are the tables mapping pathnames to entries. A closure is
 *   immutable and identified by its root hash. **Build pointers** are the only
 *   mutable state in the port: a build id names one closure, and reassigning it
 *   is how a deploy or a rollback takes effect.
 *
 * Splitting them this way is what makes rollback cheap. Republishing an earlier
 * closure rewrites no entries and re-uploads no blobs; it moves one pointer.
 *
 * The Cloudflare adapter happens to serve these two halves from two different
 * backing stores, but that is an implementation detail. An adapter MAY use one
 * backing store for both, and callers MUST NOT assume either arrangement.
 *
 * ## Hashing is the caller's job
 * The store never computes or verifies a hash. Callers supply `hash` and
 * `rootHash`, and the store treats both as opaque keys.
 *
 * This is not an oversight. Hashing lives in `addressing.js` so that every
 * platform derives byte-identical hashes from the same content; a store that
 * re-derived them could disagree across deploy targets, and content addressing
 * that is not identical across targets is not content addressing. It also means
 * a store cannot detect a caller that supplies the wrong hash — the caller owns
 * that invariant.
 *
 * ## Blob writes are idempotent, never updates
 * Writing a hash that already exists MUST succeed and MUST leave the same bytes
 * in place, because by construction the bytes are the same. Adapters may
 * therefore skip the write, overwrite it, or let the backing store decide.
 *
 * What an adapter MUST NOT do is treat `putFile()` as an update: nothing in the
 * port lets a caller replace the content at a hash, and the read caches
 * throughout the system assume that impossibility.
 *
 * ## Pathnames are carried, but never addressed by
 * `getFile()` and `putFile()` both accept the logical `pathname` of the content.
 * A blob's identity is its hash **alone**. Two pathnames sharing a hash are the
 * same blob and MUST resolve to the same stored bytes, and an adapter MUST NOT
 * key storage by pathname or refuse a read whose pathname differs from the one
 * a blob was written under.
 *
 * The argument is in the signature because it is genuinely useful to an adapter
 * that is not Cloudflare KV — a filesystem adapter may want it for a readable
 * layout or for diagnostics — and because a uniform signature is what lets
 * callers stay runtime-agnostic. The Cloudflare adapter ignores it. It is a
 * hint, not part of the key, and deduplication across pathnames is a guarantee
 * of this port rather than an accident of one adapter.
 *
 * ## Explicit typing on reads
 * The store records no type metadata, so a caller declares the representation it
 * wants on every read. There is no inference, and the accepted set differs by
 * method rather than being one shared union:
 *
 * - `getFile()` accepts `'text'`, `'arrayBuffer'`, and `'stream'`.
 * - `getFiles()` accepts `'text'` only.
 * - `putFile()` takes no type at all.
 *
 * The narrower sets are the portable floor rather than one platform's
 * limitation. A bulk read cannot stream — it resolves every value before
 * returning any of them — so offering `'stream'` there would advertise
 * something no adapter can honor. A write carries its own representation: the
 * blob argument already determines whether it is text or bytes, so a `type`
 * beside it could only ever contradict it.
 *
 * One widened list would be easier to document and would be a lie. An adapter
 * MUST reject a type outside the set for the method being called.
 *
 * ## Bulk reads: order, absence, and the key cap
 * `getFiles()` resolves an array aligned positionally with the `files` argument,
 * with `null` in the position of any blob that does not exist. Callers rely on
 * the alignment to re-associate results, so an adapter MUST NOT compact, sort,
 * or deduplicate the result.
 *
 * At most 100 blobs may be requested per call. An adapter MUST reject a longer
 * list rather than splitting it across several reads. Like the key/value port's
 * 60-second TTL floor, the cap is Cloudflare's hard limit adopted as the
 * portable floor so that a call proven on one adapter cannot throw on another.
 * Rejecting rather than fanning out is the same principle applied to cost: how
 * many blobs one read is worth is the caller's decision, and quietly turning one
 * call into five would hide that decision at exactly the point it is being made.
 *
 * ## Index entries are stored, not interpreted
 * `saveIndex()` receives an encoded index table and `getIndex()` returns one.
 * The store MAY validate that a table is well-formed enough to persist, and MUST
 * reject one it cannot store faithfully rather than storing a lossy version of
 * it. It MUST NOT reinterpret entries.
 *
 * Concretely, the table that comes back MUST be structurally identical to the
 * one that went in, **including tuple arity**: a tree entry has exactly two
 * elements and a blob entry exactly four, which is what
 * `ContentAddressableIndex` validates on the way back in. An adapter whose
 * storage flattens entries into a uniform row shape has to restore that
 * distinction on read. This is a contract requirement precisely because it is
 * easy to lose: a store that normalizes the two kinds into one shape will accept
 * every write and fail every read.
 *
 * ## Committing is two calls, in order
 * A commit is `saveIndex()` followed by `assignBuild()`, and the port has no
 * combined operation. Splitting them is what allows a closure to be uploaded
 * before it is served, and an earlier closure to be re-served without being
 * re-uploaded.
 *
 * - `saveIndex()` MUST be idempotent. Re-saving a closure under the same root
 *   hash is a no-op, since the content is by definition identical.
 * - `assignBuild()` MUST reject a root hash for which no closure has been saved.
 *   Pointing a build at a closure that does not exist yields a build that cannot
 *   be read, and failing at assignment is the last moment that is detectable.
 * - The port makes no atomicity guarantee **across** the two calls. A failure
 *   between them leaves a saved closure that no build points at, which is inert
 *   and safe: closures are content-addressed, so the retry saves the same one.
 *
 * ## Reading an index that does not exist is an error
 * `getIndex()` MUST throw when a build has no assigned closure. It MUST NOT
 * resolve `null` or an empty table.
 *
 * This is the one place the port deliberately refuses to model absence as a
 * value. An unresolvable build id means the running deploy cannot serve any
 * content at all — every page, asset, and template read goes through the index —
 * so it is an unrecoverable startup-class fault, not a cache miss the caller
 * could sensibly branch on. Returning an empty table would convert a total
 * outage into a site that renders every route as a 404.
 *
 * ## Caching and the consistency floor
 * An adapter MAY cache index reads, and the Cloudflare adapter caches at two
 * tiers. Any adapter that caches MUST invalidate its cached copy of a build when
 * `assignBuild()` reassigns it, after the assignment is durable. A rollback
 * reuses the build id it is rolling back, so a cache that waits out a TTL keeps
 * serving the closure being rolled back — for exactly as long as the TTL that
 * was meant to be an optimization.
 *
 * The contract guarantees only that an assignment is immediately visible to the
 * instance that performed it. It makes no global visibility guarantee: an
 * adapter's cache may be node-local or colo-local, and other instances may serve
 * the previous closure until their own entries expire. This is the portable
 * floor, and it is why blob keys carry a content hash — a caller can never read
 * a stale index and a fresh blob into an inconsistent view, because a changed
 * blob is a different key.
 *
 * ## Deletion is deliberately absent
 * There is no method to delete a blob, drop a closure, or unassign a build. A
 * blob may be referenced by any number of closures, including closures a
 * rollback may return to, so deciding when one is unreachable is a
 * garbage-collection problem this port does not attempt to solve. Adding a
 * `delete()` before that policy exists would invite callers to build on a
 * capability whose safe use is undefined.
 *
 * ## Construction
 * Construction MUST accept an options object containing a `logger` and MUST
 * throw when the logger is missing. Implementations create a child logger for
 * their own diagnostics, named so the adapter is identifiable in output.
 *
 * ## Context pass-through
 * Every method receives a request or execution `context` as its first argument.
 * Runtime adapters use it according to their platform:
 * - Cloudflare adapters resolve their request-scoped bindings from `context.env`
 *   on every call.
 * - Node.js adapters receive their storage location during plugin registration
 *   from immutable application config, and accept `context` for interface
 *   compatibility.
 *
 * Implementations MUST accept the argument so callers can stay runtime-agnostic.
 *
 * ## Errors
 * Per `src/docs/server-error-handling.md`:
 * - A failure of the backing store is operational. Adapters MUST throw
 *   `OperationalError`, passing the underlying failure as `cause`.
 * - A call that violates this contract — an unsupported type, an over-cap bulk
 *   read, a missing binding, an unassigned build — is a programmer error and
 *   MUST throw `AssertionError`.
 *
 * The distinction is what lets a caller tell "the platform is unwell, retry" from
 * "this deploy is misconfigured, fail loudly".
 * @see ContentAddressableStore in ./content-addressable-store.js for the framework consumer
 * @see ContentSnapshot in ./content-snapshot.js for the read and write call sites
 * @see ContentStore in ../../plugins/cloudflare-content-store/lib/content-store.js for the Cloudflare KV and Durable Object implementation
 */

/**
 * The declared representation of a blob on read.
 *
 * @typedef {('text'|'arrayBuffer'|'stream')} ContentReadType
 */

/**
 * A blob descriptor for a bulk read. Only `hash` is required; callers typically
 * pass index entry stats, whose extra properties the store ignores.
 *
 * @typedef {Object} ContentFileDescriptor
 * @property {string} hash - Content hash identifying the blob.
 */

/**
 * An encoded index table keyed by pathname, as produced by
 * `ContentAddressableIndex.buildIndex()` and accepted by its constructor. The
 * store persists and returns this shape without interpreting it.
 *
 * @typedef {Object<string, Array>} ContentIndexTable
 */

/**
 * Content-addressed blob and index store.
 *
 * @typedef {Object} ContentStoreInterface
 *
 * @property {function(Object, string): Promise<ContentIndexTable>} getIndex
 *   Retrieves the index table assigned to a build id. Throws rather than
 *   resolving `null` when the build has no assigned closure.
 *
 * @property {function(Object, ContentReadType, string, string): Promise<(string|ArrayBuffer|ReadableStream|null)>} getFile
 *   Retrieves one blob by content hash, in the requested representation.
 *   Resolves `null` when no blob is stored under that hash. The `pathname`
 *   argument is a hint and takes no part in addressing. A `'stream'` read
 *   resolves a single-use `ReadableStream`; a caller that does not consume it
 *   MUST cancel it to release the underlying resource.
 *
 * @property {function(Object, 'text', Array<ContentFileDescriptor>): Promise<Array<(string|null)>>} getFiles
 *   Retrieves up to 100 blobs, resolving an array aligned positionally with
 *   `files` and holding `null` for each blob that does not exist. Rejects a
 *   longer list rather than splitting the read.
 *
 * @property {function(Object, string, string, (string|ArrayBuffer)): Promise<void>} putFile
 *   Stores a blob under its caller-supplied content hash. Idempotent, and never
 *   an update. The `pathname` argument is a hint and takes no part in
 *   addressing. Resolves with no value.
 *
 * @property {function(Object, string, ContentIndexTable): Promise<void>} saveIndex
 *   Persists an immutable index closure under its root hash. Idempotent.
 *   Resolves with no value, and does not make the closure reachable — only
 *   `assignBuild()` does that.
 *
 * @property {function(Object, string, string): Promise<void>} assignBuild
 *   Points a build id at a previously saved closure, and invalidates any cached
 *   index for that build. Rejects a root hash with no saved closure. Resolves
 *   with no value.
 */
