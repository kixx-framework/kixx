import { assert, assertNonEmptyString } from '../../kixx/assertions/mod.js';


// PBKDF2-HMAC-SHA-512 parameters. SALT_BYTES and HASH_BYTES are fixed for all
// new hashes. ALGORITHM is embedded in the PHC string so the verifier can
// reject unknown algorithms without attempting derivation.
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;
const PBKDF2_HASH_BITS = PBKDF2_HASH_BYTES * 8;
const PBKDF2_ALGORITHM = 'pbkdf2-sha512';


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

function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
