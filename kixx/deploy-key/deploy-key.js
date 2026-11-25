// The deploy key: one secret credential that authorizes the Publishing API
// and any plugin's operations endpoints. The server holds only the key's
// SHA-256, as the DEPLOY_KEY_HASH secret, and compares digests in constant
// time.
//
// A request reads the hash as boot left it. Boot already requires the hash
// outside development and rejects a malformed one (see ./plugin.js), so this
// module doesn't check either again. If either ever happened, the comparison
// would fail and the client would get 401, which is the safe outcome.

import { isNonEmptyString } from '../assertions/mod.js';
import { UnauthenticatedError } from '../errors/mod.js';
import { generateSecretToken, sha256Hex, timingSafeEqual } from '../utils/crypto.js';


/**
 * Every deploy key starts with this, so secret scanners can find a leaked one.
 * @type {string}
 */
export const DEPLOY_KEY_PREFIX = 'kxdk_';

/**
 * The name of the secret that holds the deploy key's SHA-256.
 * @type {string}
 */
export const DEPLOY_KEY_HASH_SECRET = 'DEPLOY_KEY_HASH';

// The one environment where an unset hash leaves the deploy key open.
const DEVELOPMENT_ENVIRONMENT = 'development';

// Lowercase hex SHA-256, as sha256Hex() writes it.
const DEPLOY_KEY_HASH_PATTERN = /^[0-9a-f]{64}$/;

// How many leading hash characters name the key in an actor record. Enough to
// tell rotated keys apart, and of no use for finding the key.
const ACTOR_ID_LENGTH = 12;


/**
 * @typedef {Object} DeployKeyActor
 * @property {'deploy-key'} type
 * @property {string} id - The first 12 characters of the stored hash, or `'development'` when the key is open
 * @property {string} name - Always `'Deploy key'`
 */


/**
 * Generates a new deploy key and its hash. Show the key once, to the person
 * who will hold it, and store only the hash as DEPLOY_KEY_HASH.
 *
 * @returns {Promise<{ key: string, hash: string }>} The key (`kxdk_` and 64 lowercase hex characters, 256 random bits) and its SHA-256 as lowercase hex
 */
export async function generateDeployKey() {
    const key = generateSecretToken(DEPLOY_KEY_PREFIX);
    const hash = await sha256Hex(key);

    return { key, hash };
}

/**
 * Tells whether a value has the form of a stored deploy key hash: 64
 * lowercase hex characters.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isDeployKeyHash(value) {
    return isNonEmptyString(value) && DEPLOY_KEY_HASH_PATTERN.test(value);
}

/**
 * Checks the request's bearer credential against the stored deploy key hash.
 *
 * In development with no hash set, every request passes, with or without a
 * credential. Anywhere a hash is set, including development, the request
 * passes only when the SHA-256 of its `Authorization: Bearer` credential
 * equals the hash. A missing, malformed, or wrong credential fails.
 *
 * It never throws for a failed check, so code that answers its own 401 can
 * use it.
 *
 * @param {Object} context - The request context; reads `env.DEPLOY_KEY_HASH` and `config.environment`
 * @param {Object} request - The server request; reads `getAuthorizationBearer()`
 * @returns {Promise<boolean>} True when the request carries the deploy key, or the key is open
 */
export async function verifyDeployKey(context, request) {
    const hash = context.env[DEPLOY_KEY_HASH_SECRET];

    if (!isNonEmptyString(hash)) {
        return context.config.environment === DEVELOPMENT_ENVIRONMENT;
    }

    const credential = request.getAuthorizationBearer();

    if (credential === null) {
        return false;
    }

    return timingSafeEqual(await sha256Hex(credential), hash);
}

/**
 * Inbound middleware that admits only requests carrying the deploy key (see
 * verifyDeployKey()). A valid key grants everything behind it.
 *
 * It doesn't set `context.user`: the deploy key is not a user. A handler that
 * records who acted calls deployKeyActor().
 *
 * @param {Object} context - The request context
 * @param {Object} request - The server request
 * @param {Object} response - The server response
 * @returns {Promise<Object>} The response, unchanged
 * @throws {UnauthenticatedError} When the request doesn't carry the deploy key (401, code `DeployKeyRequired`)
 */
export async function requireDeployKey(context, request, response) {
    if (await verifyDeployKey(context, request)) {
        return response;
    }

    throw new UnauthenticatedError('A valid deploy key is required.', { code: 'DeployKeyRequired' }, requireDeployKey);
}

/**
 * The actor to record for something the deploy key did, such as creating a
 * Release.
 *
 * @param {Object} context - The request context; reads `env.DEPLOY_KEY_HASH`
 * @returns {DeployKeyActor}
 */
export function deployKeyActor(context) {
    const hash = context.env[DEPLOY_KEY_HASH_SECRET];
    const id = isNonEmptyString(hash) ? hash.slice(0, ACTOR_ID_LENGTH) : DEVELOPMENT_ENVIRONMENT;

    return { type: 'deploy-key', id, name: 'Deploy key' };
}
