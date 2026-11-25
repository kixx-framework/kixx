// Core registration: checks the deploy key hash's form at boot, on every
// platform, so a mistyped secret fails the deploy instead of every request.

import { isNonEmptyString } from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';
import { DEPLOY_KEY_HASH_SECRET, isDeployKeyHash } from './deploy-key.js';


/**
 * Fails boot when DEPLOY_KEY_HASH is set but isn't 64 lowercase hex
 * characters. An absent or empty hash passes here: the declared-secrets check
 * already requires it outside development. The message names the secret and
 * never its value.
 *
 * @param {Object} context - The application context
 * @returns {void}
 * @throws {OperationalError} When DEPLOY_KEY_HASH is malformed
 */
export function register(context) {
    const hash = context.env[DEPLOY_KEY_HASH_SECRET];

    if (isNonEmptyString(hash) && !isDeployKeyHash(hash)) {
        throw new OperationalError(
            `${ DEPLOY_KEY_HASH_SECRET } must be the SHA-256 of the deploy key, as 64 lowercase hex characters.`,
            {},
            register,
        );
    }
}
