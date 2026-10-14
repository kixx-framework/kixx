import {
    AssertionError,
    isString,
    isUndefined,
} from './vendor/kixx-assert/mod.js';


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

function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
