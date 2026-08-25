import { assert, assertArray, assertNonEmptyString, isNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';

/**
 * @module index-entry-codec
 *
 * Translates content index entries between the two shapes they live in: the
 * flat column set persisted in the Durable Object's SQL storage, and the
 * compact tuples {@link ContentAddressableIndex} requires.
 *
 * These translations live outside ContentAddressableIndexStore because that
 * class imports `cloudflare:workers`, which neither the Node nor the Deno
 * loader can resolve, putting it out of reach of the unit test suite. The rules
 * encoded here are the ones most worth testing, so they are kept in a module
 * with no runtime imports.
 */

/**
 * @typedef {['tree'|'blob', string, (number|null)?, (Object|null)?]} IndexEntryTuple
 */

/**
 * @typedef {Object} IndexEntryRow
 * @property {'tree'|'blob'} kind - Entry kind
 * @property {string} hash - Content hash of the entry
 * @property {number|null} size - Byte length of a blob; null for a tree
 * @property {string|null} metadata - Blob metadata as JSON; null when absent
 */

/**
 * Rebuilds the tuple a stored row represents.
 *
 * The caller is trusted: rows are validated on the way in by
 * {@link encodeStorageRow}, and the tuples produced here are validated again
 * by the ContentAddressableIndex constructor that receives them.
 * @param {IndexEntryRow} row - Stored row, as returned by the index SQL query
 * @returns {IndexEntryTuple} The entry in its tuple representation
 */
export function decodeStorageRow(row) {
    const { kind, hash, size, metadata } = row;

    // Entries cross the RPC boundary as tuples, and the reader validates arity
    // by kind: a tree tuple carries only its kind and hash, while a blob tuple
    // also carries size and metadata. The row shape cannot record that
    // difference, since a tree stores null in both columns, so the kind column
    // is what the arity is restored from.
    if (kind === 'tree') {
        return [ kind, hash ];
    }

    const parsedMetadata = isNonEmptyString(metadata) ? JSON.parse(metadata) : null;
    return [ kind, hash, size, parsedMetadata ];
}

/**
 * Validates an entry tuple and flattens it into storable columns.
 *
 * The exact inverse of {@link decodeStorageRow}.
 * @param {string} pathname - Pathname the entry is keyed by, used in error messages
 * @param {IndexEntryTuple} tuple - The entry to store
 * @returns {IndexEntryRow} Columns ready to bind to an INSERT
 * @throws {AssertionError} When the tuple would store a row the read path cannot use
 */
export function encodeStorageRow(pathname, tuple) {
    const messagePrefix = `encodeStorageRow: entry "${ pathname }"`;

    assertArray(tuple, `${ messagePrefix } must be a tuple`);
    const [ kind, hash, size, metadata ] = tuple;

    // INSERT OR IGNORE also suppresses NOT NULL violations, so validate
    // required columns rather than relying on it for anything but idempotency.
    assert(kind === 'tree' || kind === 'blob', `${ messagePrefix } kind must be "tree" or "blob"`);
    assertNonEmptyString(hash, `${ messagePrefix } hash`);

    // A tree tuple stops at its hash: it has no third or fourth element, so
    // both remaining columns are null and neither is checked. Validating them
    // for a tree would reject the arity the tree tuple is defined to have.
    if (kind === 'tree') {
        assert(tuple.length === 2, `${ messagePrefix } tree tuple must contain exactly 2 elements`);
        return { kind, hash, size: null, metadata: null };
    }

    assert(tuple.length === 4, `${ messagePrefix } blob tuple must contain exactly 4 elements`);
    // Left unchecked, a missing size is stored as null and passes here, then
    // fails much later on read, where the index demands a non-negative integer.
    assert(
        Number.isInteger(size) && size >= 0,
        `${ messagePrefix } blob size must be a non-negative integer`,
    );
    assert(
        metadata === null || isPlainObject(metadata),
        `${ messagePrefix } blob metadata must be a plain object or null`,
    );

    return {
        kind,
        hash,
        size,
        metadata: metadata === null ? null : JSON.stringify(metadata),
    };
}
