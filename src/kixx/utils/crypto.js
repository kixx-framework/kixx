import { AssertionError, isString } from '../assertions/mod.js';


const SHORT_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 16 random bytes (128 bits) encode to at most 22 Base62 chars.
const SHORT_ID_BYTE_LENGTH = 16;
const SHORT_ID_LENGTH = 22;

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

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
