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
 * Beside them the store keeps **publishing history**, which is append-only: a
 * **Release record** says who created a closure and from what, and an
 * **Activation** records each change to a build's assignment. See "Publishing
 * history" below.
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
 * and the local disk is the only closure. Rejecting all writes includes history:
 * a developer adapter rejects `recordRelease()`, `getRelease()`,
 * `listReleases()`, and `listActivations()`, because it has no history to keep
 * or report. This exception is restricted to local development; deployed
 * adapters preserve the full contract above.
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
 * ## Committing is three calls, in order
 * Publishing a Release is `saveIndex()`, then `recordRelease()`, then
 * `assignBuild()`, and the port has no combined operation. Splitting them is
 * what allows a closure to be uploaded before it is served, and an earlier
 * closure to be re-served without being re-uploaded.
 *
 * - `saveIndex()` MUST be idempotent. Re-saving a closure under the same root
 *   hash is a no-op, since the content is by definition identical.
 * - `recordRelease()` MUST be idempotent, and the first record wins: a repeat
 *   for the same Release changes nothing and resolves the stored record. It
 *   MUST report `MISSING_CLOSURE` rather than record a Release whose closure
 *   has not been saved, so a listed Release can always be read and assigned.
 * - `assignBuild()` MUST report `MISSING_CLOSURE` rather than assign a root
 *   hash for which no closure has been saved. Pointing a build at a closure
 *   that does not exist yields a build that cannot be read, and refusing at
 *   assignment is the last moment that is detectable. It requires the closure
 *   only, not a Release record.
 * - The port makes no atomicity guarantee **across** the three calls, and each
 *   gap is inert. A failure after `saveIndex()` leaves a saved closure with no
 *   record that no build points at; closures are content-addressed, so the
 *   retry saves the same one. A failure after `recordRelease()` leaves a
 *   recorded Release that no build points at, and the retry resolves the same
 *   record.
 * - **Inside** `assignBuild()` the pointer move and its Activation MUST be one
 *   atomic operation: both are stored or neither is. History therefore holds
 *   exactly one Activation for every `ASSIGNED` outcome and none for any other
 *   outcome. That is why `activation` is required on every call.
 *
 * ## Conditional assignment is a compare-and-swap on one pointer
 * `assignBuild()` accepts an assignment object carrying `rootHash`, a required
 * `activation`, an optional `expectedAssignmentId`, and an optional `code`.
 * For `expectedAssignmentId`, a UUID requires the current assignment identity
 * to equal that value; `null` requires the build to be unassigned; omission
 * performs an unconditional assignment. For either explicit precondition, the
 * adapter MUST compare it against the build's currently stored pointer and
 * perform the comparison and the update as one atomic operation — an
 * application-layer read followed by a separate write cannot provide this
 * guarantee, because another deploy or caller could reassign the pointer in
 * between. A mismatch MUST leave the pointer, the history, and every cache
 * untouched and MUST be reported as `CONFLICT`, not thrown as an error, because
 * a stale caller-observed pointer is an expected outcome of concurrent
 * publication rather than a programmer mistake.
 *
 * Changed assignments generate a new UUID inside the atomic operation. A valid
 * same-target no-op preserves both the stored identity and timestamp. Compare
 * identities before no-op detection, so stale same-target writes still conflict.
 *
 * ### Code info is set once
 * A build is one deployed version of the code. `code` names it: a `revision`
 * and a `fingerprint`, both required when `code` is given. The store never
 * requires `code`; who must supply it is the caller's rule. Once a build has
 * code info it never changes:
 *
 * - An assignment that omits `code` keeps the stored values.
 * - An assignment that repeats the stored values proceeds as if it had omitted
 *   them.
 * - An assignment whose `revision` or `fingerprint` differs from the stored
 *   value MUST change nothing and resolve `CODE_MISMATCH` with the stored
 *   `code`. It is a different outcome from `CONFLICT` because retrying cannot
 *   fix it: the caller is assigning under the wrong code identity, not working
 *   from a stale view of the pointer.
 * - A build with no code info takes the values from the first assignment that
 *   gives them. That includes a same-target no-op: the outcome is still
 *   `UNCHANGED`, with the root hash, timestamp, and identity preserved and no
 *   Activation, and the code info is stored. A caller that supplied code info
 *   is never told the call succeeded while the build still has none.
 *
 * ### The live commit
 * A pointer's `liveSourceRevision` is the commit its content was last
 * published from. The adapter writes it inside the atomic operation:
 *
 * - `ASSIGNED` sets it to the Activation's `sourceRevision`, or `null` when
 *   the Activation has none.
 * - `UNCHANGED` sets it to the Activation's `sourceRevision` when one is
 *   given, and keeps the stored value otherwise. A newer commit can compile
 *   to the live Release; it is then the live commit, though no Activation
 *   records it.
 *
 * ### Outcome precedence
 * An adapter MUST decide the outcome in this order, inside the atomic
 * operation:
 *
 * 1. No closure is saved under `rootHash`: `MISSING_CLOSURE`.
 * 2. `expectedAssignmentId` was given and differs from the stored identity
 *    (`null` when the build is unassigned): `CONFLICT`.
 * 3. `code` was given, the build has code info, and either value differs:
 *    `CODE_MISMATCH`.
 * 4. The build already points at `rootHash`: `UNCHANGED`.
 * 5. Otherwise: `ASSIGNED`. The adapter stamps a new identity and timestamp,
 *    writes the pointer, and appends the Activation.
 *
 * ## Publishing history
 * History is what publishing records beside the pointers. It is append-only,
 * and the store stamps every timestamp and identity itself.
 *
 * A **Release record** describes one closure: its `releaseId` (the closure's
 * root hash), who created it, its object count and total bytes, the content
 * contract version, and its provenance. The store stamps `createdAt`. A
 * Release has one record, and the first wins: publishing identical content
 * again, even from a newer source revision, keeps the first record. The newer
 * revision is recorded on the Activation instead.
 *
 * An **Activation** describes one changed assignment. The caller supplies the
 * `reason`, the `actor`, and optionally a `sourceRevision`, a plain-language
 * `summary`, and a `forceReason`. The store supplies the rest inside the
 * atomic operation: `buildId`, `fromReleaseId` (the previous root hash, or
 * `null` for a first assignment), `toReleaseId`, and an `assignmentId` and
 * `activatedAt` equal to the new pointer's `assignmentId` and `assignedAt`.
 *
 * An actor is `{ type, id, name }`. `name` is a display name stored as a
 * snapshot, because a user may be renamed or removed after publishing; it is
 * `null` when none was given. Optional text is `null` when absent.
 *
 * ### Order and paging
 * `listReleases()` and `listActivations()` resolve `{ items, cursor }`, newest
 * first. `listActivations()` lists one build's Activations when given a
 * `buildId`, and every build's otherwise; an unknown build resolves an empty
 * page.
 *
 * - "Newest first" MUST mean reverse insertion order, never timestamp order.
 *   Timestamps can tie and a clock can step back; insertion order cannot.
 * - `limit` is an integer from 1 to 100 and defaults to 100.
 * - `cursor` continues a list after the last item of an earlier page, and is
 *   `null` on the last page. A cursor is an opaque, unsigned position owned by
 *   the adapter: callers MUST NOT parse or build one, and an adapter MAY
 *   encode whatever its storage needs. It is unsigned because history is not
 *   filtered per caller, so a tampered cursor reveals nothing a first page
 *   would not.
 * - History and Release reads MUST NOT be served from an adapter cache. A
 *   caller that has just published expects to read its own write.
 *
 * `publishing-history.js` holds the validation every adapter applies to these
 * inputs, so the same bad input fails the same way on every platform.
 *
 * ## Pointer reads do not load closures
 * `getBuildPointer()` and `listBuilds()` read only mutable pointer metadata.
 * They MUST NOT load or deserialize closure entries. Pointer reads therefore
 * remain proportional to the number of builds, not the size of their sites.
 * `listBuilds()` returns every pointer newest assignment first.
 *
 * Every pointer carries `code`: the build's `{ revision, fingerprint }`, or
 * `null` when the build has none. It also carries `liveSourceRevision`, or
 * `null` when the newest publish named no commit.
 *
 * `assignBuild()` resolves one of `BUILD_ASSIGNMENT_OUTCOME.ASSIGNED`,
 * `.UNCHANGED`, `.CONFLICT`, `.MISSING_CLOSURE`, or `.CODE_MISMATCH` rather
 * than throwing for any of these outcomes, because all can result from public
 * request input (an API client's stale `expectedAssignmentId`, a desired
 * closure it never published, or a publish made from the wrong code) rather
 * than only from programmer error.
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
 * There is no method to delete a blob, drop a closure, unassign a build, or
 * remove or rewrite a Release record or an Activation. History is append-only:
 * a record of what went live is only worth keeping if it cannot be edited. A
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
 * Per `docs/server-error-handling.md`:
 * - A failure of the backing store is operational. Adapters MUST throw
 *   `OperationalError`, passing the underlying failure as `cause`.
 * - An adapter whose backing store reports a temporary overload MAY instead
 *   throw `ServiceUnavailableError` with `code: 'ContentStoreOverloaded'` and
 *   a `retryAfterSeconds` hint. It is still an operational failure.
 * - A write that fails midway MUST leave no partial state, and is an
 *   `OperationalError` like any other storage failure. In particular, an
 *   assignment whose Activation cannot be stored leaves the pointer where it
 *   was.
 * - A call that violates this contract — an unsupported type, an over-cap bulk
 *   read, a missing binding, an unassigned build, a missing or malformed
 *   `activation`, a `limit` outside 1 to 100 — is a programmer error and MUST
 *   throw `AssertionError`. Callers validate public input before it reaches
 *   the port.
 * - A malformed `cursor` is the exception. Cursors come back from public
 *   requests and only the adapter can read one, so an adapter MUST reject a
 *   cursor it cannot read with `BadRequestError` and `code: 'InvalidCursor'`:
 *   an expected input error, not a programmer error.
 *
 * The distinction is what lets a caller tell "the platform is unwell, retry" from
 * "this deploy is misconfigured, fail loudly".
 * @see ContentAddressableStore in ./content-addressable-store.js for the framework consumer
 * @see ContentSnapshot in ./content-snapshot.js for the read and write call sites
 * @see ./publishing-history.js for the history validators and constants adapters share
 * @see ContentStore in ../adapters/cloudflare/content-store/lib/content-store.js for the Cloudflare KV and Durable Object implementation
 * @see ContentStore in ../adapters/node/content-store/lib/content-store.js for the Node.js filesystem and SQLite implementation
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
 * Who created a Release or changed an assignment.
 *
 * @typedef {Object} ContentHistoryActor
 * @property {('deploy-key'|'user')} type - The kind of credential that acted.
 * @property {string} id - Identifies the key or the user.
 * @property {(string|null)} name - Display name at the time, or `null`.
 */

/**
 * The code a build runs. Set once per build.
 *
 * @typedef {Object} ContentBuildCodeInfo
 * @property {string} revision - Source revision of the build's code.
 * @property {string} fingerprint - Fingerprint of the build's code.
 */

/**
 * Mutable pointer metadata for one build.
 *
 * @typedef {Object} ContentBuildPointer
 * @property {string} rootHash - Root hash currently assigned to the build.
 * @property {string} assignedAt - ISO 8601 timestamp of the latest assignment.
 * @property {string} assignmentId - Server-generated UUID unique to this assignment.
 * @property {(ContentBuildCodeInfo|null)} code - The build's code info, or `null` when it has none.
 * @property {(string|null)} liveSourceRevision - The commit the content was last published from, or `null`.
 */

/**
 * A listed build and its pointer metadata.
 *
 * @typedef {Object} ListedContentBuildPointer
 * @property {string} buildId - Operator-chosen build identifier.
 * @property {string} rootHash - Root hash currently assigned to the build.
 * @property {string} assignedAt - ISO 8601 timestamp of the latest assignment.
 * @property {string} assignmentId - Server-generated UUID unique to this assignment.
 * @property {(ContentBuildCodeInfo|null)} code - The build's code info, or `null` when it has none.
 * @property {(string|null)} liveSourceRevision - The commit the content was last published from, or `null`.
 */

/**
 * What the caller records about a changed assignment.
 *
 * @typedef {Object} ContentActivationInput
 * @property {('publish'|'rollback'|'carry-forward'|'restore')} reason - Why the assignment is changing.
 * @property {{type: ('deploy-key'|'user'), id: string, name?: string}} actor - Who is changing it.
 * @property {string} [sourceRevision] - Source revision the content was published from.
 * @property {string} [summary] - Plain-language summary of the change.
 * @property {string} [forceReason] - Why a publish gate was overridden.
 */

/**
 * One changed assignment, as listed by `listActivations()`.
 *
 * @typedef {Object} ContentActivation
 * @property {string} buildId - The build whose assignment changed.
 * @property {string} assignmentId - The pointer identity this assignment created.
 * @property {(string|null)} fromReleaseId - Root hash assigned before, or `null` for a first assignment.
 * @property {string} toReleaseId - Root hash assigned.
 * @property {string} activatedAt - ISO 8601 timestamp, equal to the pointer's `assignedAt`.
 * @property {('publish'|'rollback'|'carry-forward'|'restore')} reason
 * @property {ContentHistoryActor} actor
 * @property {(string|null)} sourceRevision
 * @property {(string|null)} summary
 * @property {(string|null)} forceReason
 */

/**
 * The Release record passed to `recordRelease()`. The store stamps `createdAt`.
 *
 * @typedef {Object} ContentReleaseInput
 * @property {string} releaseId - Root hash of the Release's saved closure.
 * @property {{type: ('deploy-key'|'user'), id: string, name?: string}} createdBy - Who created the Release.
 * @property {number} objectCount - Number of objects in the Release.
 * @property {number} totalBytes - Total size of those objects in bytes.
 * @property {number} contractVersion - Content contract version the Release was built for.
 * @property {Object} provenance - Optional `sourceRevision`, `message`, `client`, and `intendedForBuildId`.
 */

/**
 * A stored Release record.
 *
 * @typedef {Object} ContentReleaseRecord
 * @property {string} releaseId - Root hash of the Release's closure.
 * @property {string} createdAt - ISO 8601 timestamp, stamped by the store.
 * @property {ContentHistoryActor} createdBy
 * @property {number} objectCount
 * @property {number} totalBytes
 * @property {number} contractVersion
 * @property {Object} provenance
 */

/**
 * The outcome of `recordRelease()`. `record` is the stored record: the new one
 * when created, the first one when the Release already had a record.
 *
 * @typedef {(
 *   {outcome: 'created', record: ContentReleaseRecord} |
 *   {outcome: 'exists', record: ContentReleaseRecord} |
 *   {outcome: 'missingClosure'}
 * )} ContentReleaseRecordResult
 */

/**
 * Paging options for a history list.
 *
 * @typedef {Object} ContentHistoryPageOptions
 * @property {number} [limit=100] - Page size, from 1 to 100.
 * @property {(string|null)} [cursor] - The `cursor` of an earlier page.
 */

/**
 * Paging options for `listActivations()`.
 *
 * @typedef {Object} ContentActivationPageOptions
 * @property {string} [buildId] - List this build's Activations only.
 * @property {number} [limit=100] - Page size, from 1 to 100.
 * @property {(string|null)} [cursor] - The `cursor` of an earlier page.
 */

/**
 * One page of a history list, newest first.
 *
 * @typedef {Object} ContentHistoryPage
 * @property {Array<(ContentReleaseRecord|ContentActivation)>} items
 * @property {(string|null)} cursor - Continues the list; `null` on the last page.
 */

/**
 * The desired assignment passed to `assignBuild()`.
 *
 * @typedef {Object} ContentBuildAssignment
 * @property {string} rootHash - Root hash of the closure the build should point at.
 * @property {(string|null)} [expectedAssignmentId] - A string requires the stored
 *   assignment identity to equal that UUID; `null` requires no stored pointer. The
 *   comparison and update are one atomic operation. Omission is unconditional.
 * @property {ContentActivationInput} activation - Recorded as the Activation when the
 *   assignment changes. Required on every call.
 * @property {ContentBuildCodeInfo} [code] - The build's code info. Optional on purpose:
 *   the store never requires it.
 */

/**
 * The outcome of `assignBuild()`.
 *
 * @typedef {('assigned'|'unchanged'|'conflict'|'missingClosure'|'codeMismatch')} ContentBuildAssignmentOutcome
 */

/**
 * An atomic `assignBuild()` result. Successful results contain the pointer
 * captured by the storage operation and its actual predecessor. An unchanged
 * result preserves the existing pointer timestamp and uses its root hash as
 * the predecessor. A code mismatch carries the build's stored code info.
 *
 * @typedef {(
 *   {outcome: 'assigned', pointer: ContentBuildPointer, previousRootHash: (string|null)} |
 *   {outcome: 'unchanged', pointer: ContentBuildPointer, previousRootHash: string} |
 *   {outcome: 'conflict'} |
 *   {outcome: 'missingClosure'} |
 *   {outcome: 'codeMismatch', code: ContentBuildCodeInfo}
 * )} ContentBuildAssignmentResult
 */

/**
 * Content-addressed blob and index store, with publishing history.
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
 *   Resolves pointer metadata, including the build's code info, without loading
 *   closure entries, or `null` when the build is not registered.
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
 * @property {function(Object, ContentReleaseInput): Promise<ContentReleaseRecordResult>} recordRelease
 *   Records who created a saved closure and from what. Idempotent, and the
 *   first record wins: a repeat resolves `EXISTS` with the stored record and
 *   changes nothing. Resolves `MISSING_CLOSURE` when no closure is saved under
 *   `releaseId`. The closure check, the existence check, and the insert are one
 *   atomic operation.
 *
 * @property {function(Object, string): Promise<(ContentReleaseRecord|null)>} getRelease
 *   Resolves one Release record, or `null` when the Release has none. Never
 *   throws for absence.
 *
 * @property {function(Object, ContentHistoryPageOptions=): Promise<ContentHistoryPage>} listReleases
 *   Resolves a page of Release records, newest first. Rejects a malformed
 *   cursor with `BadRequestError`, `code: 'InvalidCursor'`.
 *
 * @property {function(Object, ContentActivationPageOptions=): Promise<ContentHistoryPage>} listActivations
 *   Resolves a page of Activations, newest first: one build's when `buildId` is
 *   given, every build's otherwise. An unknown build resolves an empty page.
 *   Rejects a malformed cursor with `BadRequestError`, `code: 'InvalidCursor'`.
 *
 * @property {function(Object, string, ContentBuildAssignment): Promise<ContentBuildAssignmentResult>} assignBuild
 *   Points a build id at a previously saved closure, optionally only when the
 *   build's current assignment identity still equals `expectedAssignmentId`,
 *   and appends the Activation in the same atomic operation. An `UNCHANGED`
 *   result means the explicit precondition passed and the target was already
 *   current; it preserves the stored timestamp and identity, appends no
 *   Activation, stores `code` only when the build had none, and updates
 *   `liveSourceRevision` when the Activation names one. On an
 *   `ASSIGNED` outcome, makes a best effort to invalidate locally cached
 *   indexes for that build; concurrent reads and other instances may still
 *   serve the previous closure until their cache entries expire. A `CONFLICT`,
 *   `MISSING_CLOSURE`, or `CODE_MISMATCH` outcome changes nothing, and no
 *   outcome but `ASSIGNED` touches a cache.
 */

/**
 * The possible outcomes of `assignBuild()`.
 *
 * @type {{ASSIGNED: 'assigned', UNCHANGED: 'unchanged', CONFLICT: 'conflict', MISSING_CLOSURE: 'missingClosure', CODE_MISMATCH: 'codeMismatch'}}
 */
export const BUILD_ASSIGNMENT_OUTCOME = Object.freeze({
    ASSIGNED: 'assigned',
    UNCHANGED: 'unchanged',
    CONFLICT: 'conflict',
    MISSING_CLOSURE: 'missingClosure',
    CODE_MISMATCH: 'codeMismatch',
});

/**
 * The possible outcomes of `recordRelease()`.
 *
 * @type {{CREATED: 'created', EXISTS: 'exists', MISSING_CLOSURE: 'missingClosure'}}
 */
export const RELEASE_RECORD_OUTCOME = Object.freeze({
    CREATED: 'created',
    EXISTS: 'exists',
    MISSING_CLOSURE: 'missingClosure',
});
