/**
 * Node.js utility functions — platform-specific utilities using Node.js built-in APIs.
 *
 * @module node-utils
 */
import { randomUUID, subtle } from 'node:crypto';


/**
 * Creates a new UUID v4.
 *
 * @see {import('../../ports/platform-utils.js').PlatformUtils} PlatformUtils port
 * @public
 * @returns {string}
 */
export function createRandomUUID() {
    return randomUUID();
}

/**
 * Hashes data using SHA-256 and returns a lowercase hex-encoded digest string.
 * String inputs are encoded as UTF-8 before hashing.
 *
 * @see {import('../../ports/platform-utils.js').PlatformUtils} PlatformUtils port
 * @public
 * @param {string|ArrayBuffer|TypedArray} data - Data to hash
 * @returns {Promise<string>} Lowercase hex-encoded SHA-256 digest
 */
export async function computeSHA256(data) {
    const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
