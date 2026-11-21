import { AssertionError, isString, isUndefined } from '../assertions/mod.js';


const SHORT_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 16 random bytes (128 bits) encode to at most 22 Base62 chars.
const SHORT_ID_BYTE_LENGTH = 16;
const SHORT_ID_LENGTH = 22;
const SECRET_TOKEN_BYTE_LENGTH = 32;

/**
 * Generates a cryptographically random, URL-safe Base62 ID.
 *
 * Draws 128 bits of entropy from the Web Crypto CSPRNG (crypto.getRandomValues),
 * a global available in both Node.js and the Cloudflare Workers runtime, so the
 * IDs are suitable for use as collision-resistant identifiers.
 *
 * IDs are fixed-width (22 chars), left-padded with '0' when the random value
 * encodes to fewer digits. The Base62 alphabet ('0-9A-Za-z') contains only
 * unreserved characters, so an ID is safe to embed directly in a URL path
 * segment without escaping.
 *
 * @returns {string} 22-character Base62 ID
 */
export function generateShortId() {
    const bytes = new Uint8Array(SHORT_ID_BYTE_LENGTH);
    crypto.getRandomValues(bytes);

    // Combine the random bytes into a single big-endian 128-bit integer. BigInt
    // is required because the value far exceeds Number's safe integer range.
    let n = 0n;
    for (const b of bytes) {
        n = (n << 8n) | BigInt(b);
    }

    // Encode the integer as Base62 by repeated division, prepending each digit
    // so the most-significant digit ends up first.
    let out = '';
    while (n > 0n) {
        out = SHORT_ID_ALPHABET[Number(n % 62n)] + out;
        n = n / 62n;
    }

    return out.padStart(SHORT_ID_LENGTH, '0');
}

/**
 * Generates a 256-bit secret token encoded as lowercase hexadecimal text.
 * @param {string} [prefix] - Optional literal prefix prepended to the random token body.
 * @returns {string} Secret token suitable for login links, sessions, or API credentials.
 * @throws {AssertionError} When prefix is present and is not a string.
 */
export function generateSecretToken(prefix) {
    const tokenPrefix = isUndefined(prefix) ? '' : prefix;

    if (!isString(tokenPrefix)) {
        throw new AssertionError('generateSecretToken() prefix must be a string when present');
    }

    const bytes = new Uint8Array(SECRET_TOKEN_BYTE_LENGTH);
    crypto.getRandomValues(bytes);

    return `${ tokenPrefix }${ bytesToHex(bytes) }`;
}

/**
 * Hashes bytes or a UTF-8 string with SHA-256 and returns a lowercase hex digest.
 *
 * Uses the Web Crypto `crypto.subtle.digest` API, a global available in both
 * Node.js and the Cloudflare Workers runtime, so the same helper produces ETag
 * values and content hashes on every target platform.
 *
 * @param {ArrayBuffer|ArrayBufferView|string} data - Raw bytes (such as a file
 *   body) or a string, which is encoded as UTF-8 before hashing.
 * @returns {Promise<string>} Hex-encoded SHA-256 digest.
 * @throws {AssertionError} When data is not a string, ArrayBuffer, or ArrayBufferView.
 */
export async function sha256Hex(data) {
    // crypto.subtle.digest accepts a BufferSource; a string must be encoded to
    // bytes first. Reject anything else loudly so a wrong-typed caller crashes
    // here rather than producing a digest of coerced garbage.
    let bytes;
    if (isString(data)) {
        bytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        bytes = data;
    } else {
        throw new AssertionError('sha256Hex() data must be a string, ArrayBuffer, or ArrayBufferView');
    }

    const digest = await crypto.subtle.digest('SHA-256', bytes);

    return bytesToHex(new Uint8Array(digest));
}

/**
 * Generates a uniformly random string of decimal digits, such as a one-time code.
 * @param {number} length - Positive integer number of digits.
 * @returns {string} Digit string of exactly `length` characters; leading zeros are kept.
 * @throws {AssertionError} When length is not a positive integer.
 */
export function generateNumericCode(length) {
    if (!Number.isInteger(length) || length <= 0) {
        throw new AssertionError('generateNumericCode() length must be a positive integer');
    }

    const values = new Uint8Array(1);
    let code = '';

    while (code.length < length) {
        crypto.getRandomValues(values);

        // Rejection sampling: 250 is the largest multiple of 10 not above 256.
        // Mapping 250-255 with modulo would make digits 0-5 slightly more likely.
        if (values[0] < 250) {
            code += String(values[0] % 10);
        }
    }

    return code;
}

/**
 * Compares two strings in time that depends only on their lengths, not on
 * where they first differ. Use it to compare secret digests.
 * @param {string} a - First string.
 * @param {string} b - Second string.
 * @returns {boolean} True when both strings are identical.
 * @throws {AssertionError} When either argument is not a string.
 */
export function timingSafeEqual(a, b) {
    if (!isString(a) || !isString(b)) {
        throw new AssertionError('timingSafeEqual() arguments must be strings');
    }

    // Lengths are not secret here: callers compare fixed-width digests.
    if (a.length !== b.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return diff === 0;
}

function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
