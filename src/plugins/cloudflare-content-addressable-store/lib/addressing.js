/**
 * Provides deterministic serialization, hashing, and encoding for the generic
 * content-addressable store, plus a defensive pathname check for its own key
 * space.
 *
 * This module owns no content-layout vocabulary. The `/templates` and
 * `/pages` namespace, reserved bundle filenames, and the canonical Hyperview
 * pathname rule belong to `src/kixx/hyperview/content-layout.js`. See
 * `isValidPathname()`/`normalizePathname()` below for why this module still
 * keeps its own copy of the pathname check.
 *
 * Wire format v1:
 *   - digest: SHA-256 truncated to 128 bits, base32 (RFC 4648 lowercase, no pad)
 *   - domains: blobs, trees, digest-sets and etags use distinct prefix bytes
 *   - values: general-purpose hashes do not use a content-store domain byte
 *   - keys: two-character format prefix so a future format can coexist
 *
 * @module cloudflare-content-addr-store/addressing
 */

import {
    isString,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import { canonicalize, compareStrings } from '../../../kixx/utils/canonicalize.js';


// Re-exported for existing callers within this content-addressable store
// package. The definitions live in kixx/utils/canonicalize.js because
// deterministic serialization is needed on both sides of the publishing wire
// contract: Hyperview produces the bytes it uploads, and this module's
// digest functions consume the same bytes when hashing.
export { canonicalize, compareStrings };

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

// This is a deliberate duplicate of the canonical pathname rule
// `src/kixx/hyperview/content-layout.js` also implements, not a shared
// source of Hyperview semantics. Hyperview owns the canonical pathname rule
// and normalizes and validates every pathname before calling this store's
// `putBlob()`; this copy is an invariant check across the port boundary,
// guarding only this store's own key space (the index, blob keys, and
// directory-tree construction below). It must not import
// `src/kixx/hyperview/content-layout.js` or the unrelated, expected-to-be-
// deprecated `src/kixx/utils/validate-pathname.js`.

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
