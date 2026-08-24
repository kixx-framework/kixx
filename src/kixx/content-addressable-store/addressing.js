import {
    isString,
    isUndefined,
} from '../assertions/mod.js';

/**
 * @module addressing
 *
 * Derives the content addresses everything else in this directory is keyed by.
 *
 * Two properties make the rest of the design work, and both are this module's
 * responsibility alone:
 *
 * 1. **Identical across platforms.** Every deploy target must derive the same
 *    digest from the same content, or a blob uploaded from one runtime is
 *    unreachable from another. Nothing here uses a platform API beyond
 *    `crypto.subtle` and `TextEncoder`, and the store deliberately never
 *    computes a hash of its own.
 * 2. **Stable across time.** Digests are persisted in published index closures,
 *    so a change to the canonical byte sequence or the domain separators does
 *    not merely produce different hashes — it orphans every closure already
 *    published. That is what {@link FORMAT} exists to gate.
 *
 * Digests are SHA-256 truncated to 128 bits and rendered as lowercase base32, so
 * they are safe in a URL path, a storage key, and a case-insensitive
 * intermediary alike.
 */

/**
 * Identifies the current storage-key and digest wire format.
 *
 * Bump this whenever a change makes previously computed digests
 * irreproducible or previously written keys unreadable. It namespaces blob
 * keys (see {@link KEY}), the Cloudflare index cache URL and Durable Object
 * instance name, and the root hash itself, so a bump re-isolates all of them
 * together and old data is never read back under the new rules.
 *
 * History:
 * - `1` — initial format.
 * - `2` — the domain bytes below were renumbered when `hashBlob` was split
 *   into `hashArrayBufferBlob` and `hashStringBlob`. Tree, set, and text-blob
 *   digests all moved; array-buffer blob digests did not. Nothing had been
 *   deployed at the time, so this bump records the change rather than
 *   migrating anything.
 * @type {number}
 * @readonly
 */
export const FORMAT = 2;

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

// A domain byte makes the semantic type part of the hashed input. Without it,
// a blob containing the canonical bytes of a tree, set or value would have the
// same digest as that object. Domains separate types; they do not increase the
// hash algorithm's resistance to random collisions within a type.
const DOMAIN_ARRAY_BUFFER_BLOB = 0x00;
const DOMAIN_STRING_BLOB = 0x01;
const DOMAIN_TREE = 0x02;
const DOMAIN_SET = 0x03;
const DOMAIN_STRING = 0x04;

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
 * Within this port it is normative across time rather than across
 * implementations: blob hashes and etags derived from these bytes are
 * persisted in the index, so any change to the output orphans every committed
 * closure and requires a `FORMAT` migration.
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
 * Hashes raw bytes from an ArrayBuffer blob.
 * @param {ArrayBuffer} bytes - Blob content
 * @returns {Promise<string>} Content digest in the current wire format
 */
export async function hashArrayBufferBlob(bytes) {
    if (bytes instanceof ArrayBuffer) {
        return await digestDomain(DOMAIN_ARRAY_BUFFER_BLOB, new Uint8Array(bytes));
    }
    throw new TypeError('hashArrayBufferBlob: bytes is not an ArrayBuffer');
}

/**
 * Hashes a string blob under the string blob domain.
 * @param {string} value - Blob content
 * @returns {Promise<string>} Content digest in the current wire format
 */
export async function hashStringBlob(value) {
    if (isString(value)) {
        return await digestDomain(DOMAIN_STRING_BLOB, stringToUint8Array(value));
    }
    throw new TypeError('hashStringBlob: value must be a string');
}

/**
 * Hashes a canonicalizable tree under the tree domain.
 * @param {Object|Array<*>} obj - Tree to canonicalize and hash
 * @returns {Promise<string>} Tree digest in the current wire format
 * @throws {TypeError} When the tree contains a value that cannot be canonicalized
 */
export async function hashTree(obj) {
    return await digestDomain(DOMAIN_TREE, stringToUint8Array(canonicalize(obj)));
}

/**
 * Hashes an arbitrary string under the string domain. Usually used for
 * creating cache and storage keys.
 * @param {string} value
 * @returns {Promise<string>} String digest in the current wire format
 */
export async function hashString(value) {
    if (isString(value)) {
        return await digestDomain(DOMAIN_STRING, stringToUint8Array(value));
    }
    throw new TypeError('hashString: value must be a string');
}
