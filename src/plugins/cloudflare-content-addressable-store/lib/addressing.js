/**
 * Provides deterministic serialization, hashing, and encoding for the generic
 * content-addressable store, plus a defensive pathname check for its own key
 * space.
 *
 * Wire format v1:
 *   - digest: SHA-256 truncated to 128 bits, base32 (RFC 4648 lowercase, no pad)
 *   - domains: blobs, trees, digest-sets and etags use distinct prefix bytes
 *   - values: general-purpose hashes do not use a content-store domain byte
 *   - keys: two-character format prefix so a future format can coexist
 *
 * The wire format is this adapter's own and stays internal to it.
 * `ContentAddressableStoreInterface` specifies neither a digest algorithm nor
 * a canonical serialization, only that an adapter be internally
 * deterministic.
 *
 * Nothing outside this package derives a digest, external publishing clients
 * included. The optional `x-checksum` header on a publishing upload carries
 * an etag the client received from an earlier stat of already-published
 * content and echoes back unchanged; `putBlob()` recomputes the etag from the
 * bytes it was handed and rejects a mismatch. The header asserts "what I am
 * uploading is what you already have", so the digest stays opaque to the
 * client and no derivation needs publishing.
 *
 * The format must nonetheless stay stable over time. Blob hashes and etags
 * are persisted in the index, so a change to `canonicalize()` or to any
 * digest below would orphan every committed closure — the same content would
 * address differently. `FORMAT` exists to gate such a change.
 *
 * @module cloudflare-content-addr-store/addressing
 * @see ../../../kixx/content-store/content-addressable-store-interface.js for the port this adapter's store implements
 */

import {
    isString,
    isUndefined,
} from '../../../kixx/assertions/mod.js';

/**
 * Identifies the current storage-key and digest wire format.
 * @type {number}
 * @readonly
 */
export const FORMAT = 1;

/**
 * Storage-key prefixes for each persisted content-addressing structure.
 * @enum {string}
 * @readonly
 */
export const KEY = {
    blob: `b:${FORMAT}:`,
};

// SHA-256 truncated to 128 bits; ~1e-21 collision probability at 1e9 objects.
const DIGEST_BYTES = 16;

// Our Base32 encoding alphabet.
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

// Path segments are restricted to a conservative filename-safe set. Anything
// outside it (path separators beyond the segment split, query/fragment
// characters, whitespace, shell or URL metacharacters) is rejected before the
// path reaches a storage adapter or static file store.
const DISALLOWED_PATHNAME_CHARACTERS = /[^a-z0-9_.-]/i;

// A domain byte makes the semantic type part of the hashed input. Without it,
// a blob containing the canonical bytes of a tree, set or value would have the
// same digest as that object. Domains separate types; they do not increase the
// hash algorithm's resistance to random collisions within a type.
const DOMAIN_BLOB = 0x00;
const DOMAIN_TREE = 0x01;
const DOMAIN_SET = 0x02;
const DOMAIN_ETAG = 0x03;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Compares strings in UTF-16 code-unit order.
 * @param {string} a - Left operand
 * @param {string} b - Right operand
 * @returns {number} Negative, zero or positive when a sorts before, with or after b
 */
export function compareStrings(a, b) {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}

/**
 * Serializes a JSON-compatible value deterministically, sorting object keys,
 * omitting undefined object properties and removing insignificant whitespace.
 *
 * This is a wire-format primitive of *this adapter*, not shared framework
 * code. The port specifies no canonical serialization, so another
 * content-addressable store adapter may serialize differently and produce
 * different digests for the same value; nothing outside this package may
 * import this function.
 *
 * Within this adapter it is normative across time rather than across
 * implementations: blob hashes and etags derived from these bytes are
 * persisted in the index, so any change to the output orphans every committed
 * closure and requires a `FORMAT` migration. Object keys sort by UTF-16 code unit; object
 * properties whose value is `undefined` are omitted; arrays preserve order;
 * output has no insignificant whitespace; numbers use `JSON.stringify()`
 * formatting; and non-finite numbers are rejected.
 *
 * @param {null|boolean|number|string|Array<*>|Object} value - Value to serialize
 * @returns {string} Deterministic JSON representation
 * @throws {TypeError} When value contains a non-finite number or unsupported type
 */
export function canonicalize(value) {
    if (value === null) {
        return 'null';
    }

    const t = typeof value;
    if (t === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`canonicalize: non-finite number ${ value }`);
        }
        return JSON.stringify(value);
    }
    if (t === 'string' || t === 'boolean') {
        return JSON.stringify(value);
    }
    if (t !== 'object') {
        throw new TypeError(`canonicalize: unsupported type ${ t }`);
    }
    if (Array.isArray(value)) {
        return `[${ value.map(canonicalize).join(',') }]`;
    }

    const keys = Object.keys(value)
        .filter((k) => !isUndefined(value[k]))
        .sort(compareStrings);

    const parts = keys.map((k) => {
        return `${ JSON.stringify(k) }:${ canonicalize(value[k]) }`;
    });

    return `{${ parts.join(',') }}`;
}

/**
 * Encodes a string as UTF-8 bytes.
 * @param {string} str - String to encode
 * @returns {Uint8Array} UTF-8 encoded bytes
 */
export function stringToUint8Array(str) {
    return encoder.encode(str);
}

/**
 * Decodes UTF-8 bytes into a string, replacing malformed sequences.
 * @param {Uint8Array} bytes - UTF-8 encoded bytes
 * @returns {string} Decoded string
 */
export function bufferToString(bytes) {
    return decoder.decode(bytes);
}

// The isValidPathname and normalizePathname functions may seem like duplicates
// if the canonical pathname rules in the Kixx Hyperview Services. But, they
// serve different purposes, so fundamentally they are not duplicates even
// if the logic appears to be the same. These functions are an invariant check
// across the port boundary, guarding only this store's own key space
// (the index, blob keys, and directory-tree construction below)

/**
 * Reports whether a logical pathname contains only lowercase and
 * safe path segments.
 * @param {string} pathname - The pathname to check
 * @returns {boolean} True when the pathname is valid
 */
export function isValidPathname(pathname) {
    // Must be a string.
    if (!isString(pathname)) {
        return false;
    }

    // Two dots or two slashes are always invalid.
    if (pathname.includes('..') || pathname.includes('//')) {
        return false;
    }

    // Must be a lowercase case.
    if (pathname.toLowerCase() !== pathname) {
        return false;
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        // A leading dot on any segment (dotfiles, `.` itself) is rejected in
        // addition to the disallowed-character check.
        if (part.startsWith('.') || DISALLOWED_PATHNAME_CHARACTERS.test(part)) {
            return false;
        }
    }

    return true;
}

/**
 * Folds a ContentAddressableStore pathname to its canonical form, removing
 * trailing, and consecutive slashes "/" before converting to lower case
 * and ensuring it starts with a slash "/".
 * @param {string} value - Identifier to normalize
 * @returns {string} The validated identifier folded to lower case
 */
export function normalizePathname(value) {
    if (!isString(value)) {
        throw new TypeError('An identifier must be a string');
    }

    // Remove leading, trailing, and multiple consecutive slashes ("/") and
    // convert to lower case.
    const id = value.split('/')
        .filter((part) => part)
        .join('/')
        .toLowerCase();

    return '/' + id;
}

/**
 * Copies the bytes visible through an ArrayBuffer view into a standalone buffer.
 * @param {ArrayBufferView} typedArray - View whose byte range to copy
 * @returns {ArrayBuffer|SharedArrayBuffer} New buffer containing only the viewed bytes
 * @throws {TypeError} When the view's backing ArrayBuffer is detached
 */
export function typedArrayToBuffer(typedArray) {
    const { byteOffset, byteLength } = typedArray;
    // Make sure we are handling cases where the allocated buffer is
    // larger than the data in the view.
    return typedArray.buffer.slice(byteOffset, byteLength + byteOffset);
}

/**
 * Encodes bytes as lowercase, unpadded RFC 4648 base32 suitable for URLs and
 * case-insensitive intermediaries.
 * @param {Uint8Array} bytes - Bytes to encode
 * @returns {string} Lowercase, unpadded base32 text
 */
function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
        value = ((value << 8) | bytes[i]) >>> 0;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += BASE32[(value >>> bits) & 31];
        }
        // Drop consumed high bits so `value` can never overflow 32 bits.
        value = bits === 0 ? 0 : value & ((1 << bits) - 1);
    }

    if (bits > 0) {
        out += BASE32[(value << (5 - bits)) & 31];
    }

    return out;
}

async function digestBuffer(buf) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const full = new Uint8Array(digest);
    return base32Encode(full.subarray(0, DIGEST_BYTES));
}

async function digestDomain(domain, payload) {
    const buf = new Uint8Array(1 + payload.length);
    buf[0] = domain;
    buf.set(payload, 1);

    return await digestBuffer(buf);
}

/**
 * Hashes a canonicalizable collection under the digest-set domain.
 * @param {Object|Array<*>} obj - Collection to canonicalize and hash
 * @returns {Promise<string>} Content digest in the current wire format
 * @throws {TypeError} When the collection contains a value that cannot be canonicalized
 */
export async function hashSet(obj) {
    return await digestDomain(DOMAIN_SET, stringToUint8Array(canonicalize(obj)));
}

/**
 * Hashes a blob hash and its metadata into an opaque file-version digest.
 * @param {string} blobHash - Content digest identifying the blob bytes
 * @param {Object|null} [metadata=null] - Metadata associated with the blob
 * @returns {Promise<string>} Unquoted content-and-metadata digest in the current wire format
 */
export async function hashEtag(blobHash, metadata = null) {
    const value = {
        v: FORMAT,
        blobHash,
        metadata: metadata ?? null,
    };
    return await digestDomain(DOMAIN_ETAG, stringToUint8Array(canonicalize(value)));
}

/**
 * Hashes raw bytes under the blob domain.
 * @param {Uint8Array} bytes - Blob content
 * @returns {Promise<string>} Content digest in the current wire format
 */
export async function hashBlob(bytes) {
    return await digestDomain(DOMAIN_BLOB, bytes);
}

/**
 * Hashes a canonicalizable tree under the tree domain.
 * @param {Object|Array<*>} obj - Tree to canonicalize and hash
 * @returns {Promise<string>} Content digest in the current wire format
 * @throws {TypeError} When the tree contains a value that cannot be canonicalized
 */
export async function hashTree(obj) {
    return await digestDomain(DOMAIN_TREE, stringToUint8Array(canonicalize(obj)));
}

/**
 * Hashes a primitive or canonicalizable object without a content-store domain
 * byte. Unlike hashBlob(), hashTree() and hashSet(), this function exposes the
 * underlying digest algorithm for callers outside the content-addressable
 * store which do not share one of its domain-specific data models.
 * @param {*} value - Value to hash
 * @returns {Promise<string>} Content digest in the current wire format
 * @throws {TypeError} When a non-primitive value cannot be canonicalized
 */
export async function hashValue(value) {
    if (isUndefined(value)) {
        value = 'undefined';
    } else if (typeof value === 'bigint') {
        value = `${ value }n`;
    } else if (typeof value === 'symbol') {
        value = `${ value }`;
    } else {
        value = canonicalize(value);
    }
    return await digestBuffer(stringToUint8Array(value));
}
