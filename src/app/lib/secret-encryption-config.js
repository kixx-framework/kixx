import { assert, isPlainObject } from '../../kixx/assertions/mod.js';


/**
 * Reads the PBKDF2 iteration count from the SECRET_ENCRYPTION configuration
 * namespace (`config.env.SECRET_ENCRYPTION.PBKDF2_ITERATIONS`).
 *
 * The work factor is configured per environment so it can be tuned without a
 * code change. It is required: a misconfigured deployment must fail loudly
 * before any password hash is derived or verified, rather than silently
 * weakening credential security.
 *
 * @param {import('../../kixx/context/request-context.js').default} context - Active request context.
 * @returns {number} A positive integer PBKDF2 iteration count.
 * @throws {AssertionError} When the SECRET_ENCRYPTION config section is missing
 *   or PBKDF2_ITERATIONS is not a positive integer.
 */
export function getPbkdf2Iterations(context) {
    const secretEncryption = context.config?.env?.SECRET_ENCRYPTION;

    assert(
        isPlainObject(secretEncryption),
        'Missing SECRET_ENCRYPTION configuration section',
    );

    const iterations = secretEncryption.PBKDF2_ITERATIONS;

    assert(
        Number.isInteger(iterations) && iterations > 0,
        'SECRET_ENCRYPTION.PBKDF2_ITERATIONS must be a positive integer',
    );

    return iterations;
}
