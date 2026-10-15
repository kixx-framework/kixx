import { createHash } from 'node:crypto';
import { isString, isUndefined } from '../vendor/kixx-assert/mod.js';

/**
 * @module publishing/addressing
 *
 * Synchronous `node:crypto` port of the framework's addressing format 4 in
 * repo `lib/kixx/content-addressable-store/addressing.js`.
 *
 * {@link FORMAT} is pinned to the framework's storage and digest wire format.
 * `test/conformance/addressing.test.js` compares this port with that module;
 * when FORMAT changes upstream, also regenerate the fixed vectors in
 * `test/lib/publishing/addressing.test.js`.
 *
 * Format 4 reset the storage namespace for UUID build assignment identities
 * and left the digest unchanged, so every format 3 vector still holds. A
 * future bump that does change a vector changes every object id this tool
 * computes, and is a migration rather than a constant edit.
 */

/**
 * Identifies the framework storage-key and digest wire format this port matches.
 * @type {number}
 * @readonly
 */
export const FORMAT = 4;

// SHA-256 truncated to 128 bits; ~1e-21 collision probability at 1e9 objects.
const DIGEST_BYTES = 16;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

// Blobs are addressed by their bytes since format 3, so text and its UTF-8
// encoding intentionally share the same domain and content address.
const DOMAIN_BLOB = 0x00;

const encoder = new TextEncoder();

/**
 * Compares strings in UTF-16 code-unit order.
 * @param {string} a - Left operand
 * @param {string} b - Right operand
 * @returns {number} Negative, zero, or positive when a sorts before, with, or after b
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
 * Serializes a JSON-compatible value deterministically.
 * @param {null|boolean|number|string|Array<*>|Object} value - Value to serialize
 * @returns {string} Deterministic JSON representation
 * @throws {TypeError} When value contains a non-finite number or unsupported type
 */
export function canonicalize(value) {
    if (value === null) {
        return 'null';
    }

    // Preserve the upstream primitive/object distinction. The assertion
    // predicates also accept boxed primitives, which canonicalize as objects.
    const type = typeof value;
    if (type === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`canonicalize: non-finite number ${ value }`);
        }
        return JSON.stringify(value);
    }
    if (type === 'string' || type === 'boolean') {
        return JSON.stringify(value);
    }
    if (type !== 'object') {
        throw new TypeError(`canonicalize: unsupported type ${ type }`);
    }
    if (Array.isArray(value)) {
        return `[${ value.map(canonicalize).join(',') }]`;
    }

    const keys = Object.keys(value)
        .filter((key) => !isUndefined(value[key]))
        .sort(compareStrings);

    const parts = keys.map((key) => {
        return `${ JSON.stringify(key) }:${ canonicalize(value[key]) }`;
    });

    return `{${ parts.join(',') }}`;
}

/**
 * Hashes a blob by its bytes, encoding strings as UTF-8.
 * @param {string|ArrayBuffer} value - Blob content
 * @returns {string} Content digest in the current wire format
 * @throws {TypeError} When value is neither a string nor an ArrayBuffer
 */
export function hashBlob(value) {
    if (isString(value)) {
        return digestDomain(DOMAIN_BLOB, encoder.encode(value));
    }
    if (value instanceof ArrayBuffer) {
        return digestDomain(DOMAIN_BLOB, new Uint8Array(value));
    }
    throw new TypeError('hashBlob: value must be a string or ArrayBuffer');
}

/**
 * Measures a publishable blob using the framework content-store convention.
 * @param {string|ArrayBuffer} value - Blob content
 * @returns {number} UTF-8 byte length for text, or byteLength for binary content
 * @throws {TypeError} When value is neither a string nor an ArrayBuffer
 */
export function getBlobSize(value) {
    if (isString(value)) {
        return encoder.encode(value).byteLength;
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    throw new TypeError('getBlobSize: value must be a string or an ArrayBuffer');
}

function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let output = '';

    for (let index = 0; index < bytes.length; index += 1) {
        value = ((value << 8) | bytes[index]) >>> 0;
        bits += 8;

        while (bits >= 5) {
            bits -= 5;
            output += BASE32[(value >>> bits) & 31];
        }

        // Retaining only unconsumed bits keeps the accumulator within 32 bits.
        value = bits === 0 ? 0 : value & ((1 << bits) - 1);
    }

    if (bits > 0) {
        output += BASE32[(value << (5 - bits)) & 31];
    }

    return output;
}

function digestDomain(domain, payload) {
    const hash = createHash('sha256');
    hash.update(Uint8Array.of(domain));
    hash.update(payload);

    return base32Encode(hash.digest().subarray(0, DIGEST_BYTES));
}
