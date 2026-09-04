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
 * ## Developer-mode exception
 * A local developer adapter MAY bend three rules which depend on immutable
 * publication: it may address reads by `pathname` instead of `hash`, reject all
 * writes, and ignore `buildId`. Mutable source files cannot be addressed by a
 * stale hash, publishing through a source-backed server is a configuration bug,
 * and the local disk is the only closure. This exception is restricted to local
 * development; deployed adapters preserve the full contract above.
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
 * `statFiles()` has the same 100-key cap and positional alignment, returning
 * `{ size }` for a stored blob and `null` for an absent one. Implementations
 * MUST answer without loading payload bytes. Where the blob backing store
 * cannot report metadata cheaply, the adapter may maintain a registry, but a
 * positive result MUST come from strongly consistent state. A false missing
 * result only causes an idempotent re-upload; a false present result could let
 * a release name bytes which cannot be read.
 *
 * ## Index entries are stored, not interpreted
 * `saveIndex()` receives an encoded index table already validated by the
 * framework, and `getIndex()` returns one. An adapter remains responsible for
 * rejecting a value its backing representation cannot store faithfully, but it
 * MUST NOT reinterpret entries.
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
 * - `assignBuild()` MUST report `MISSING_CLOSURE` rather than assign a root
 *   hash for which no closure has been saved. Pointing a build at a closure
 *   that does not exist yields a build that cannot be read, and refusing at
 *   assignment is the last moment that is detectable.
 * - The port makes no atomicity guarantee **across** `saveIndex()` and
 *   `assignBuild()`. A failure between them leaves a saved closure that no
 *   build points at, which is inert and safe: closures are content-addressed,
 *   so the retry saves the same one.
 *
 * ## Conditional assignment is a compare-and-swap on one pointer
 * `assignBuild()` accepts an assignment object carrying `rootHash` and an
 * optional `expectedRootHash`. A string requires the current pointer to equal
 * that value; `null` requires the build to be unassigned; omission performs an
 * unconditional assignment. For either explicit precondition, the adapter
 * MUST compare it against the build's currently stored pointer and perform the
 * comparison and the update as one atomic operation — an application-layer
 * read followed by a separate write cannot provide this guarantee, because
 * another deploy or caller could reassign the pointer in between. A mismatch
 * MUST leave the pointer and every cache untouched and MUST be reported as
 * `CONFLICT`, not thrown as an error, because a stale caller-observed pointer
 * is an expected outcome of concurrent publication rather than a programmer
 * mistake. Omitting `expectedRootHash` performs the existing unconditional
 * assignment.
 *
 * ## Pointer reads do not load closures
 * `getBuildPointer()` and `listBuilds()` read only mutable pointer metadata.
 * They MUST NOT load or deserialize closure entries. Pointer reads therefore
 * remain proportional to the number of builds, not the size of their sites.
 * `listBuilds()` returns every pointer newest assignment first.
 *
 * `assignBuild()` resolves one of `BUILD_ASSIGNMENT_OUTCOME.ASSIGNED`,
 * `.CONFLICT`, or `.MISSING_CLOSURE` rather than throwing for any of these
 * three outcomes, because all three can now result from public request input
 * (an API client's stale `expectedRootHash`, or a desired closure it never
 * published) rather than only from programmer error.
 *
 * ## Resolving a build never throws for absence
 * `getBuild()` resolves `{ rootHash, entries }` when the build is registered,
 * and `null` when it is not — it MUST NOT throw for an unregistered build.
 * `rootHash` is the exact stored pointer value, not a hash the caller
 * recomputes.
 *
 * This is a deliberate change from treating build absence as an unrecoverable
 * fault at the port boundary. The port is now used both by the framework's own
 * startup-critical read of the running deploy's active build, and by public
 * publishing-API request handling that must distinguish "no such build" from a
 * platform failure without an assertion. Callers that require the running
 * deploy to always have an assigned closure — such as page rendering — enforce
 * that invariant themselves, one layer up, where a missing closure is
 * unambiguously a server configuration error rather than absence of a build a
 * client merely asked about.
 *
 * ## Caching and the consistency floor
 * An adapter MAY cache index reads. The Cloudflare adapter uses a bounded
 * isolate-local cache. When `assignBuild()` reassigns a build, an adapter
 * SHOULD make a best effort to invalidate its local cached copy after the
 * assignment is durable. A concurrent read may repopulate a cache with the
 * previous closure after invalidation, however, and other adapter instances
 * may retain their copies until they expire.
 *
 * The contract therefore makes no immediate-visibility guarantee. Concurrent
 * reads and other adapter instances or colos may serve the previous closure
 * until their cache entries expire. This bounded staleness is safe because
 * closures and blobs are immutable and content-addressed: an older index still
 * names the exact blobs belonging to that coherent snapshot rather than mixing
 * old index data with newly written blob content.
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
 * Stored metadata for a content-addressed blob.
 *
 * @typedef {Object} ContentFileStat
 * @property {number} size - Stored payload size in bytes.
 */

/**
 * An encoded index table keyed by pathname, as produced by
 * `ContentAddressableIndex.buildIndex()` and accepted by its constructor. The
 * store persists and returns this shape without interpreting it.
 *
 * @typedef {Object<string, Array>} ContentIndexTable
 */

/**
 * The closure currently assigned to a build, as resolved by `getBuild()`.
 *
 * @typedef {Object} ContentBuildLookup
 * @property {(string|null)} rootHash - The exact stored pointer value. A
 *   developer-mode adapter with no persisted pointer resolves `null` here
 *   while still returning scanned `entries`; deployed adapters resolve a
 *   non-empty root hash for every build this returns non-null for.
 * @property {ContentIndexTable} entries - Encoded index table for that closure.
 */

/**
 * Mutable pointer metadata for one build.
 *
 * @typedef {Object} ContentBuildPointer
 * @property {string} rootHash - Root hash currently assigned to the build.
 * @property {string} assignedAt - ISO 8601 timestamp of the latest assignment.
 */

/**
 * A listed build and its pointer metadata.
 *
 * @typedef {Object} ListedContentBuildPointer
 * @property {string} buildId - Operator-chosen build identifier.
 * @property {string} rootHash - Root hash currently assigned to the build.
 * @property {string} assignedAt - ISO 8601 timestamp of the latest assignment.
 */

/**
 * The desired assignment passed to `assignBuild()`.
 *
 * @typedef {Object} ContentBuildAssignment
 * @property {string} rootHash - Root hash of the closure the build should point at.
 * @property {(string|null)} [expectedRootHash] - A string requires the stored
 *   pointer to equal that hash; `null` requires no stored pointer. The
 *   comparison and update are one atomic operation. Omission is unconditional.
 */

/**
 * The result of `assignBuild()`. See `BUILD_ASSIGNMENT_OUTCOME` for the
 * three possible values.
 *
 * @typedef {('assigned'|'conflict'|'missingClosure')} ContentBuildAssignmentOutcome
 */

/**
 * Content-addressed blob and index store.
 *
 * @typedef {Object} ContentStoreInterface
 *
 * @property {function(Object, string): Promise<(ContentBuildLookup|null)>} getBuild
 *   Resolves the closure currently assigned to a build id, or `null` when the
 *   build is not registered. Never throws for build absence.
 *
 * @property {function(Object, string): Promise<(ContentIndexTable|null)>} getIndex
 *   Resolves an immutable closure directly by root hash, or null when absent.
 *
 * @property {function(Object, string): Promise<(ContentBuildPointer|null)>} getBuildPointer
 *   Resolves pointer metadata without loading closure entries, or `null` when
 *   the build is not registered.
 *
 * @property {function(Object): Promise<Array<ListedContentBuildPointer>>} listBuilds
 *   Resolves every registered build newest assignment first without loading
 *   closure entries.
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
 * @property {function(Object, Array<string>): Promise<Array<(ContentFileStat|null)>>} statFiles
 *   Reports metadata for up to 100 content hashes without reading payload
 *   bytes. Results align positionally with the input and contain `null` for
 *   absent blobs. Rejects a longer list rather than splitting the read.
 *
 * @property {function(Object, string, string, (string|ArrayBuffer)): Promise<number>} putFile
 *   Stores a blob under its caller-supplied content hash. Idempotent, and never
 *   an update. The `pathname` argument is a hint and takes no part in
 *   addressing. Resolves with the stored blob's byte size after the write
 *   succeeds. String sizes are measured as UTF-8 encoded bytes.
 *
 * @property {function(Object, string, ContentIndexTable): Promise<void>} saveIndex
 *   Persists a framework-validated immutable index closure under its root hash.
 *   Idempotent. Resolves with no value, and does not make the closure reachable
 *   — only `assignBuild()` does that. Adapters reject values their backing
 *   representation cannot store faithfully.
 *
 * @property {function(Object, string, ContentBuildAssignment): Promise<ContentBuildAssignmentOutcome>} assignBuild
 *   Points a build id at a previously saved closure, optionally only when the
 *   build's current pointer still equals `expectedRootHash`. On an `ASSIGNED`
 *   outcome, makes a best effort to invalidate locally cached indexes for that
 *   build; concurrent reads and other instances may still serve the previous
 *   closure until their cache entries expire. A `CONFLICT` or `MISSING_CLOSURE`
 *   outcome leaves the pointer and every cache untouched.
 */

/**
 * The three possible resolutions of `assignBuild()`.
 *
 * @type {{ASSIGNED: 'assigned', CONFLICT: 'conflict', MISSING_CLOSURE: 'missingClosure'}}
 */
export const BUILD_ASSIGNMENT_OUTCOME = Object.freeze({
    ASSIGNED: 'assigned',
    CONFLICT: 'conflict',
    MISSING_CLOSURE: 'missingClosure',
});
