import { createHash } from 'node:crypto';

/**
 * Deterministic JSON encoding and hashing for idempotency checks. Two
 * structurally equal values always canonicalize and hash identically,
 * regardless of key insertion order, platform, or process.
 * @module canonical-hash
 */

/**
 * Serializes a JSON-representable value with object keys sorted recursively
 * and no whitespace. Array order is preserved, since order is meaningful in
 * some hashed values (such as `compatibility_flags`); a caller that wants an
 * order-independent hash must sort the array before calling this.
 * @param {*} value - Any JSON-representable value.
 * @returns {string} Canonical JSON text with no whitespace.
 * @throws {TypeError} When `value` contains a function, `BigInt`, or a
 *     circular reference, so a digest is never taken over a partial structure.
 */
export function canonicalize(value) {
    return JSON.stringify(sortKeys(value, new Set()));
}

/**
 * Hashes UTF-8 text with SHA-256.
 * @param {string} text - Text to hash.
 * @returns {string} 64-character lowercase hex digest.
 */
export function sha256Hex(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Hashes a JSON-representable value by its canonical form.
 * @param {*} value - Any JSON-representable value.
 * @returns {string} 64-character lowercase hex digest.
 * @throws {TypeError} When `value` is not JSON-representable. See {@link canonicalize}.
 */
export function hashValue(value) {
    return sha256Hex(canonicalize(value));
}

function sortKeys(value, seen) {
    if (typeof value === 'function' || typeof value === 'bigint' || typeof value === 'symbol') {
        throw new TypeError(`canonicalize() cannot represent a ${ typeof value } value`);
    }

    if (value === null || typeof value !== 'object' || value instanceof Date) {
        return value;
    }

    if (seen.has(value)) {
        throw new TypeError('canonicalize() cannot represent a circular reference');
    }

    seen.add(value);

    let result;
    if (Array.isArray(value)) {
        result = value.map((entry) => sortKeys(entry, seen));
    } else {
        result = {};
        for (const key of Object.keys(value).sort()) {
            const entry = value[key];
            if (entry !== undefined) {
                result[key] = sortKeys(entry, seen);
            }
        }
    }

    seen.delete(value);

    return result;
}
