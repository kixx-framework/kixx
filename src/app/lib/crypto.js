import {
    AssertionError,
    assert,
    assertNonEmptyString,
    isString,
    isUndefined,
} from '../../kixx/assertions/mod.js';


const SECRET_TOKEN_BYTE_LENGTH = 32;

// PBKDF2-HMAC-SHA-512 parameters. SALT_BYTES and HASH_BYTES are fixed for all
// new hashes. ALGORITHM is embedded in the PHC string so the verifier can
// reject unknown algorithms without attempting derivation.
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;
const PBKDF2_HASH_BITS = PBKDF2_HASH_BYTES * 8;
const PBKDF2_ALGORITHM = 'pbkdf2-sha512';


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
 * Hashes a non-empty string with SHA-256 and returns a lowercase hex digest.
 * @param {string} value - Non-empty value to hash.
 * @returns {Promise<string>} Hex-encoded SHA-256 digest.
 * @throws {AssertionError} When value is not a non-empty string.
 */
export async function sha256Hex(value) {
    assertNonEmptyString(value, 'sha256Hex() value');

    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);

    return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}


/**
 * Derives a PBKDF2-HMAC-SHA-512 hash of `password` and returns a PHC-encoded
 * credential string suitable for storage in `UserRecord.password_hash`.
 *
 * The returned string embeds the iteration count and salt so that
 * `verifyPassword` can reconstruct the hash without reading any env var.
 * Changing `PBKDF2_ITERATIONS` in config therefore does not invalidate
 * credentials stored under a previous iteration count.
 *
 * @param {string} password - Plaintext password to hash.
 * @param {number} iterations - PBKDF2 iteration count.
 * @returns {Promise<string>} PHC string: `$pbkdf2-sha512$i=<n>$<salt-b64>$<hash-b64>`.
 * @throws {AssertionError} When password is not a non-empty string or iterations
 *   is not a positive integer.
 */
export async function pbkdf2HashPassword(password, iterations) {
    assertNonEmptyString(password, 'pbkdf2HashPassword: password must be a non-empty string');
    assert(
        Number.isInteger(iterations) && iterations > 0,
        'hashPassword: iterations must be a positive integer',
    );

    const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
    const hash = await pbkdf2DeriveKey(password, salt, iterations);

    return `$${ PBKDF2_ALGORITHM }$i=${ iterations }$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/**
 * Verifies a plaintext password against a PHC-encoded credential string
 * produced by `pbkdf2HashPassword()`.
 *
 * The comparison is constant-time with respect to the position of the first
 * differing byte, so timing differences do not leak information about the
 * stored hash value.
 *
 * @param {string} password - Plaintext password to verify.
 * @param {string} phcString - Stored PHC credential string from `UserRecord.password_hash`.
 * @returns {Promise<boolean>} `true` when the password matches the stored hash.
 * @throws {AssertionError} When password or phcString is not a non-empty string,
 *   or when the PHC string is malformed or names an unsupported algorithm.
 */
export async function verifyPassword(password, phcString) {
    assertNonEmptyString(password, 'verifyPassword: password must be a non-empty string');
    assertNonEmptyString(phcString, 'verifyPassword: phcString must be a non-empty string');

    const { iterations, salt, hash } = parsePHCString(phcString);
    const derived = await pbkdf2DeriveKey(password, salt, iterations);

    return timingSafeEqual(derived, hash);
}

/**
 * Runs PBKDF2-HMAC-SHA-512 key derivation over `password` using the given
 * salt and iteration count. Always produces exactly `HASH_BYTES` bytes.
 * @param {string} password - Plaintext password.
 * @param {Uint8Array} salt - Random salt bytes.
 * @param {number} iterations - PBKDF2 iteration count.
 * @returns {Promise<Uint8Array>} Derived key bytes.
 */
async function pbkdf2DeriveKey(password, salt, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        [ 'deriveBits' ],
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations,
            hash: 'SHA-512',
        },
        keyMaterial,
        PBKDF2_HASH_BITS,
    );

    return new Uint8Array(derivedBits);
}

/**
 * Parses a PHC credential string into its component parts.
 *
 * Expected format: `$pbkdf2-sha512$i=<n>$<salt-b64>$<hash-b64>`
 *
 * @param {string} phcString
 * @returns {{ iterations: number, salt: Uint8Array, hash: Uint8Array }}
 * @throws {AssertionError} When the string is malformed or names an unsupported algorithm.
 */
function parsePHCString(phcString) {
    // Splitting on '$' yields ['', algorithm, params, saltB64, hashB64].
    const parts = phcString.split('$');

    assert(parts.length === 5, 'verifyPassword: malformed PHC string — wrong number of segments');
    assert(parts[1] === PBKDF2_ALGORITHM, `verifyPassword: unsupported algorithm "${ parts[1] }" in PHC string`);

    const iterMatch = /^i=(\d+)$/.exec(parts[2]);
    assert(iterMatch !== null, 'verifyPassword: malformed iterations param in PHC string');

    return {
        iterations: parseInt(iterMatch[1], 10),
        salt: base64ToBytes(parts[3]),
        hash: base64ToBytes(parts[4]),
    };
}

/**
 * Compares two byte arrays in constant time. Returns `true` only when every
 * byte matches. XORs corresponding bytes and ORs all differences so that no
 * early exit leaks the position of the first mismatch.
 *
 * Both arrays are produced by `deriveKey` with the same `HASH_BYTES` output
 * size, so the length check is a safety guard rather than a runtime branch
 * that varies with the input.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a[i] ^ b[i];
    }

    return diff === 0;
}

/**
 * Encodes a byte array as standard base64 using `btoa`.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

/**
 * Decodes a standard base64 string into a byte array using `atob`.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
