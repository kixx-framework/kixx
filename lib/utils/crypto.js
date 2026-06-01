
const SHORT_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 16 random bytes (128 bits) encode to at most 22 Base62 chars.
const SHORT_ID_BYTE_LENGTH = 16;
const SHORT_ID_LENGTH = 22;

/**
 * Generates a cryptographically random, URL-safe Base62 ID.
 *
 * IDs are fixed-width (22 chars), left-padded with '0' when the random value
 * encodes to fewer digits. Safe to embed directly in URL path segments.
 *
 * @returns {string} 22-character Base62 ID
 */
export function generateShortId() {
    const bytes = new Uint8Array(SHORT_ID_BYTE_LENGTH);
    crypto.getRandomValues(bytes);

    let n = 0n;
    for (const b of bytes) {
        n = (n << 8n) | BigInt(b);
    }

    let out = '';
    while (n > 0n) {
        out = SHORT_ID_ALPHABET[Number(n % 62n)] + out;
        n = n / 62n;
    }

    return out.padStart(SHORT_ID_LENGTH, '0');
}
