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
 * `hashValue()` and every hash exposed by this port (`ContentStat.hash`,
 * `ContentStat.etag`, `rootHash`, `computeHashFromStats()`) are opaque
 * strings in the *implementing adapter's* wire format. Callers MUST treat
 * them as opaque identifiers — suitable for equality comparison and as cache
 * keys — and MUST NOT parse their structure, assume a fixed length, or
 * depend on the format.
 *
 * ## Digests are adapter-specific, not portable
 * This port deliberately does not specify a digest algorithm, a canonical
 * serialization, or a wire format. Each adapter owns its own; see
 * "Serialization is the adapter's business" below. Two consequences bind
 * every caller:
 *
 * - **Determinism is promised within one store, not across stores.** An
 *   adapter MUST produce the same digest for the same input for as long as
 *   its wire format is unchanged, so digests are safe to compare and to use
 *   as cache keys. Two different adapters MAY produce entirely different
 *   digests for identical input, and callers MUST NOT assume otherwise.
 * - **Digests MUST NOT be persisted across an adapter or format change.**
 *   Anything durable that embeds a digest — a cache key, an ETag served to a
 *   client, a stored manifest — is invalidated by swapping the backing store
 *   or bumping its format. Such data must be safe to discard, or must be
 *   migrated deliberately.
 *
 * ## Serialization is the adapter's business
 * `putObject()` requires only that a value be serialized *deterministically*:
 * the same logical value MUST produce byte-identical output every time,
 * within a given adapter and wire format. How that is achieved — key
 * ordering, treatment of `undefined` properties, number formatting, which
 * values are rejected as unserializable — is the adapter's own affair and is
 * NOT part of this contract. An adapter is free to choose a serialization
 * suited to its platform.
 *
 * Callers therefore MUST NOT reimplement, mirror, or depend on a particular
 * serialization to predict a hash. To obtain a digest, call the store.
 *
 * ## The optional etag precondition
 * The optional `etag` argument to the `put*()` methods is a precondition, not
 * a checksum the caller computes. A caller obtains the value by reading an
 * existing resource's `ContentStat.etag` — through a snapshot, or through an
 * HTTP API that surfaces one, as the publishing API's stat endpoint does —
 * and passes that opaque string back unchanged on a later write. The store
 * recomputes the etag from the bytes it actually produced and rejects a
 * mismatch with a `ValidationError`. Supplying it therefore asserts that the
 * content being written is identical to the content the etag came from;
 * omitting it writes unconditionally.
 *
 * Digest opacity holds end to end as a result. No caller computes a digest,
 * a remote publishing client included — such a client only round-trips a
 * value the store gave it. An adapter therefore never needs to publish its
 * derivation, and callers need to know nothing beyond "it either matches or
 * raises `ValidationError`".
 *
 * ## Caller-visible errors
 * - `putBlob()`, `putUtf8()`, and `putObject()` reject with a
 *   `ValidationError` when a supplied `etag` does not match the etag
 *   recomputed from the produced bytes and metadata. `putObject()` also
 *   throws `TypeError` when its value cannot be serialized by the adapter's
 *   deterministic serializer.
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
 * `putUtf8()`, `putObject()`, `commitChanges()`). Implementations use it
 * according to their platform — for example, a Cloudflare adapter resolves
 * its request-scoped KV and Durable Object bindings from `context.env` on
 * every call. `hashValue()` takes no context because it is a pure digest
 * function with no storage access.
 *
 * ## Pathnames are the caller's responsibility
 * This port does not validate or normalize pathnames beyond rejecting an
 * unsafe one defensively at its own storage boundary. A caller MUST supply
 * pathnames already normalized to the store's canonical form.
 *
 * ## Implementations beyond the contract
 * An adapter may expose methods this port does not name — a lower-level
 * index read, or the separate closure-commit and build-assign steps that
 * `commitChanges()` composes. Those are the adapter's own surface, not part
 * of the contract, and framework code MUST NOT call them. Adapters mark them
 * `@private` so the port surface stays legible in the implementation.
 */

/**
 * A single node in a resolved content index: either a directory ("tree") or
 * a file ("blob").
 *
 * @typedef {Object} ContentStat
 * @property {string} pathname - Normalized pathname for the node, with a leading slash "/".
 * @property {('tree'|'blob')} kind - 'tree' for a directory, 'blob' for a file.
 * @property {string} hash - Content digest of the blob's bytes, or of the tree's child list. Opaque; see "Digest opacity".
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
 *   Computes a deterministic digest for a primitive or serializable value.
 *   Used by callers that need a stable identity for cache keys and similar
 *   purposes, independent of any stored blob. Deterministic within this
 *   store only; see "Digests are adapter-specific, not portable".
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
 * @property {function(Object, string, string, (Object|null), string=): Promise<PutBlobResult>} putUtf8
 *   Encodes `text` as UTF-8 and writes the resulting bytes with the same
 *   addressing and integrity behavior as `putBlob()`.
 *
 * @property {function(Object, string, *, (Object|null), string=): Promise<PutBlobResult>} putObject
 *   Deterministically serializes `value`, encodes it as UTF-8, and writes the
 *   resulting bytes with the same addressing and integrity behavior as
 *   `putBlob()`. The serialization is the adapter's own; see "Serialization
 *   is the adapter's business". Throws `TypeError` when `value` cannot be
 *   serialized.
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
