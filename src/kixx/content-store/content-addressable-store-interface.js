/**
 * ContentAddressableStoreInterface — the contract for immutable,
 * content-addressed blob storage plus the immutable index that names a
 * closure of pathnames over those blobs.
 *
 * This is a generic storage primitive. It knows nothing about pages,
 * templates, or any other Hyperview vocabulary — it stores bytes under a
 * logical pathname and commits an immutable pathname closure identified by a
 * root hash. Framework code that needs Hyperview semantics builds them on top
 * of this port; see `src/kixx/hyperview/` for that layer.
 *
 * ## Blob immutability
 * A blob is identified by the content hash of its bytes. Once written, a
 * blob's bytes at a given hash never change — `putBlob()` is safe to retry
 * and safe to call again for content already stored. There is no update or
 * delete operation for a blob's bytes; a logical "change" is always a new
 * blob under a new hash, referenced by a new closure.
 *
 * ## Snapshot pinning and request lifetime
 * `openSnapshot()` resolves the current build's index once and returns a
 * `ContentIndexSnapshotInterface` pinned to that resolved index. Every read
 * performed through the returned snapshot — `statPath()`, `listStats()`,
 * `getBlob()`, `getBlobs()`, `computeHashFromStats()`, and the `rootHash`
 * getter — observes that same pinned index, even if the build is reassigned
 * to a different closure before the snapshot is done being used. A caller
 * MUST NOT retain a snapshot beyond the request that opened it: a snapshot is
 * a request-scoped view, not a long-lived cache.
 *
 * ## Digest opacity
 * `hashValue()` and every hash embedded in a `ContentStat` (`hash`, `etag`,
 * `rootHash`) are opaque strings in the store's current wire format. Callers
 * MUST treat them as opaque identifiers — suitable for equality comparison
 * and as cache keys — and MUST NOT parse their structure, assume a fixed
 * length, or depend on the wire format across a store implementation change.
 *
 * ## Caller-visible errors
 * - `putBlob()` rejects with a `ValidationError` when a supplied `etag` does
 *   not match the etag recomputed from the uploaded bytes and metadata.
 * - `commitChanges()` rejects with a `ValidationError` when `files` contains
 *   a malformed entry, a duplicate pathname, or a pathname that collides with
 *   another entry's directory.
 * - A backing-store failure (a failed remote call, an inconsistent index)
 *   surfaces as an `OperationalError`. An internal invariant violation — for
 *   example, an unreadable blob referenced by a resolved index entry —
 *   surfaces as an `AssertionError`, because it indicates corrupted state
 *   rather than an operational condition the caller can act on.
 *
 * ## Context pass-through
 * Every method that reads or writes storage takes a request or execution
 * `context` as its first argument (`openSnapshot()`, `putBlob()`,
 * `commitChanges()`). Implementations use it according to their platform —
 * for example, a Cloudflare adapter resolves its request-scoped KV and
 * Durable Object bindings from `context.env` on every call. `hashValue()`
 * takes no context because it is a pure digest function with no storage
 * access.
 *
 * ## Pathnames are the caller's responsibility
 * This port does not validate or normalize pathnames beyond rejecting an
 * unsafe one defensively at its own storage boundary. It does not expose
 * `normalizePathname()` or `isValidPathname()`: no framework caller consumes
 * either operation directly, and pathname semantics — the canonical rule
 * Hyperview pathnames follow — belong to the layer that owns that
 * vocabulary, not to generic storage. A caller MUST supply pathnames already
 * normalized to the store's canonical form.
 *
 * ## Runtime adapters
 * @see CloudflareContentStore in ../../plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js for the Cloudflare KV and Durable Object implementation
 */

/**
 * A single node in a resolved content index: either a directory ("tree") or
 * a file ("blob").
 *
 * @typedef {Object} ContentStat
 * @property {string} pathname - Normalized pathname for the node, with a leading slash "/".
 * @property {('tree'|'blob')} kind - 'tree' for a directory, 'blob' for a file.
 * @property {string} hash - Content digest of the blob's bytes, or of the tree's canonicalized child list. Opaque; see "Digest opacity".
 * @property {string} etag - Digest of a blob's content hash and metadata, or the content hash for a tree. Opaque; see "Digest opacity".
 * @property {number|null} size - Byte size of a blob, or null for a tree.
 * @property {Object|null} metadata - Caller-supplied metadata for a blob, or null.
 */

/**
 * A file to include when committing a new closure, before directory nodes
 * are derived.
 *
 * @typedef {Object} ContentManifestFile
 * @property {string} pathname - Normalized pathname for the file, with a leading slash "/".
 * @property {string} hash - Content digest of the file bytes, as returned by `putBlob()`.
 * @property {number} size - Byte size of the file.
 * @property {Object} [metadata] - Caller-supplied metadata to associate with the file.
 */

/**
 * Descriptor returned after writing a blob, suitable for inclusion in the
 * `files` array passed to `commitChanges()`.
 *
 * @typedef {Object} PutBlobResult
 * @property {string} pathname - The pathname the blob was addressed by; carried through unchanged, not used as the storage key.
 * @property {string} hash - Content digest of the stored bytes. Opaque; see "Digest opacity".
 * @property {number} size - Byte size of the stored content.
 * @property {Object|null} metadata - The metadata supplied to `putBlob()`, carried through unchanged.
 */

/**
 * Descriptor identifying one committed closure.
 *
 * @typedef {Object} CommitResult
 * @property {string} rootHash - Root hash identifying the committed closure. Opaque; see "Digest opacity".
 * @property {number} nodeCount - Total number of file and directory nodes in the closure.
 */

/**
 * Immutable content-addressable blob store and closure committer.
 *
 * @typedef {Object} ContentAddressableStoreInterface
 *
 * @property {function(*): Promise<string>} hashValue
 *   Computes a deterministic digest for a primitive or JSON-canonicalizable
 *   value. Used by callers that need a stable identity for cache keys and
 *   similar purposes, independent of any stored blob.
 *
 * @property {function(Object): Promise<ContentIndexSnapshotInterface>} openSnapshot
 *   Opens a request-scoped view pinned to one immutable content index. See
 *   "Snapshot pinning and request lifetime".
 *
 * @property {function(Object, string, Uint8Array, (Object|null), string=): Promise<PutBlobResult>} putBlob
 *   Writes a blob's bytes under its content hash, independent of the
 *   `commitChanges()` step that makes it reachable through a build's index.
 *   When `etag` is supplied, it MUST match the etag recomputed from the
 *   uploaded bytes and metadata, or the call rejects with a
 *   `ValidationError`.
 *
 * @property {function(Object, string, ContentManifestFile[]): Promise<CommitResult>} commitChanges
 *   Derives an immutable closure from `files` — the directory tree implied by
 *   their pathnames — commits it, and points `buildId` at it. This is the
 *   only way a build's pointer changes, for both deploying a new closure and
 *   rolling back to one committed earlier; it never rewrites closure content.
 *   Rejects with a `ValidationError` when `files` contains a malformed,
 *   duplicate, or colliding entry.
 */

/**
 * Request-scoped, read-only view of one immutable content index.
 *
 * @typedef {Object} ContentIndexSnapshotInterface
 *
 * @property {string} rootHash
 *   Root hash of the immutable index pinned for this snapshot. Opaque; see
 *   "Digest opacity".
 *
 * @property {function(string): Promise<ContentStat|null>} statPath
 *   Looks up a single node in the pinned index by exact pathname. Resolves
 *   `null` when no entry exists at that pathname.
 *
 * @property {function(string, Object=): Promise<ContentStat[]>} listStats
 *   Lists the nodes under a directory prefix in the pinned index, in
 *   pathname sort order. `options.recursive` defaults to `true`; when
 *   `false`, only the prefix's immediate children are returned.
 *
 * @property {function(string): Promise<Uint8Array|null>} getBlob
 *   Reads a single blob's bytes by content hash, using this snapshot's
 *   request bindings. Resolves `null` when no blob exists under that hash.
 *
 * @property {function(string[]): Promise<Array<Uint8Array|null>>} getBlobs
 *   Reads several blobs' bytes by content hash, in the same order as
 *   `hashes`; an entry is `null` when no blob exists under that hash.
 *
 * @property {function(ContentStat[]): Promise<string>} computeHashFromStats
 *   Computes a deterministic digest from a set of stats' content hash and
 *   metadata, independent of the order `stats` was supplied in. Suitable for
 *   use as an aggregate etag over several files.
 */
