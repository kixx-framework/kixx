// The deploy key: one secret credential that authorizes the Publishing API
// and any plugin's operations endpoints. The server holds only the key's
// SHA-256, as the DEPLOY_KEY_HASH secret, and compares digests in constant
// time.
//
// A request reads the hash as boot left it. Boot already requires the hash
// outside development and rejects a malformed one (see ./plugin.js), so this
// module doesn't check either again. If either ever happened, the comparison
// would fail and the client would get 401, which is the safe outcome.
//
// Failed checks are counted per client IP on the KeyValueStore, so a client
// guessing keys is slowed down (see DEPLOY_KEY_FAILURE_LIMIT). The correct key
// is never counted or limited. Counting is best-effort: the store has no
// atomic increment, and a store failure is logged and ignored.

import { isNonEmptyString } from '../assertions/mod.js';
import { TooManyRequestsError, UnauthenticatedError } from '../errors/mod.js';
import { isDevelopmentEnvironment } from '../config/environment.js';
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

// The actor id recorded when the deploy key is open in development.
const DEVELOPMENT_ACTOR_ID = 'development';

// Lowercase hex SHA-256, as sha256Hex() writes it.
const DEPLOY_KEY_HASH_PATTERN = /^[0-9a-f]{64}$/;

// How many leading hash characters name the key in an actor record. Enough to
// tell rotated keys apart, and of no use for finding the key.
const ACTOR_ID_LENGTH = 12;

// Each window's counts live under their own keys, so a new window starts at 0.
const FAILURE_KEY_PREFIX = 'kixx:deploy-key-failures';

// A count outlives its window by this much, which keeps every expiry past the
// KeyValueStore's 60-second floor.
const FAILURE_EXPIRY_MARGIN_SECONDS = 60;

/**
 * Failed deploy key checks allowed per client IP in one window. After
 * `maxFailures`, a wrong or missing key from that IP gets 429 until the window
 * ends. A request with no known IP shares one count.
 * @type {{ maxFailures: number, windowSeconds: number }}
 */
export const DEPLOY_KEY_FAILURE_LIMIT = Object.freeze({ maxFailures: 20, windowSeconds: 900 });


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
 * Creates the deploy key check with its own clock. verifyDeployKey() and
 * requireDeployKey() below are this, with the real clock. Tests pass `now`.
 *
 * @param {Object} [options]
 * @param {function(): number} [options.now] - A clock returning milliseconds since the epoch; defaults to `Date.now()`
 * @returns {{ verifyDeployKey: function(Object, Object): Promise<boolean>, requireDeployKey: function(Object, Object, Object): Promise<Object> }}
 */
export function createDeployKeyAuthentication({ now = () => Date.now() } = {}) {

    // Resolves { verified: true }, or the failure with the IP's limit state.
    async function checkDeployKey(context, request) {
        const hash = context.env[DEPLOY_KEY_HASH_SECRET];

        if (!isNonEmptyString(hash) && isDevelopmentEnvironment(context.config)) {
            return { verified: true };
        }

        if (await presentsDeployKey(request, hash)) {
            return { verified: true };
        }

        return countFailure(context, request);
    }

    async function countFailure(context, request) {
        const { maxFailures, windowSeconds } = DEPLOY_KEY_FAILURE_LIMIT;

        const nowSeconds = Math.floor(now() / 1000);
        const windowStart = nowSeconds - (nowSeconds % windowSeconds);
        const windowEnd = windowStart + windowSeconds;

        const ip = request.ip ?? 'unknown';
        const key = `${ FAILURE_KEY_PREFIX }:${ windowStart }:${ ip }`;
        const store = context.getService('KeyValueStore');

        let count = 0;
        try {
            count = parseCount(await store.get(context, key));
        } catch (error) {
            context.logger.warn('deploy key failure count unavailable', { requestId: context.requestId, ip }, error);
        }

        if (count >= maxFailures) {
            return { verified: false, limited: true, retryAfterSeconds: Math.max(1, windowEnd - nowSeconds) };
        }

        try {
            await store.put(context, key, String(count + 1), { expiresAt: windowEnd + FAILURE_EXPIRY_MARGIN_SECONDS });
        } catch (error) {
            context.logger.warn('deploy key failure not counted', { requestId: context.requestId, ip }, error);
        }

        return { verified: false, limited: false };
    }

    /**
     * Checks the request's bearer credential against the stored deploy key hash.
     *
     * In development with no hash set, every request passes, with or without a
     * credential. Anywhere a hash is set, including development, the request
     * passes only when the SHA-256 of its `Authorization: Bearer` credential
     * equals the hash. A missing, malformed, or wrong credential fails, and
     * the failure is counted against the client IP.
     *
     * It never throws for a failed check, including a limited IP, so code that
     * answers its own 401 can use it.
     *
     * @param {Object} context - The request context; reads `env.DEPLOY_KEY_HASH` and `config.environment`, and counts failures on the `KeyValueStore` service
     * @param {Object} request - The server request; reads `getAuthorizationBearer()` and `ip`
     * @returns {Promise<boolean>} True when the request carries the deploy key, or the key is open
     */
    async function verifyDeployKey(context, request) {
        const { verified } = await checkDeployKey(context, request);
        return verified;
    }

    /**
     * Inbound middleware that admits only requests carrying the deploy key (see
     * verifyDeployKey()). A valid key grants everything behind it.
     *
     * It doesn't set `context.user`: the deploy key is not a user. A handler
     * that records who acted calls deployKeyActor().
     *
     * @param {Object} context - The request context
     * @param {Object} request - The server request
     * @param {Object} response - The server response
     * @returns {Promise<Object>} The response, unchanged
     * @throws {UnauthenticatedError} When the request doesn't carry the deploy key (401, code `DeployKeyRequired`)
     * @throws {TooManyRequestsError} When it doesn't, and its IP is over DEPLOY_KEY_FAILURE_LIMIT (429, code `TooManyFailedAttempts`, with `retryAfterSeconds`)
     */
    async function requireDeployKey(context, request, response) {
        const { verified, limited, retryAfterSeconds } = await checkDeployKey(context, request);

        if (verified) {
            return response;
        }

        if (limited) {
            throw new TooManyRequestsError(
                'Too many failed deploy key attempts. Try again later.',
                { code: 'TooManyFailedAttempts', retryAfterSeconds },
                requireDeployKey,
            );
        }

        throw new UnauthenticatedError('A valid deploy key is required.', { code: 'DeployKeyRequired' }, requireDeployKey);
    }

    return { verifyDeployKey, requireDeployKey };
}

const defaultAuthentication = createDeployKeyAuthentication();

/**
 * Checks the request's deploy key and resolves true or false; never throws
 * for a failed or limited check. See createDeployKeyAuthentication().
 * @type {function(Object, Object): Promise<boolean>}
 */
export const verifyDeployKey = defaultAuthentication.verifyDeployKey;

/**
 * Inbound middleware that admits only requests carrying the deploy key, with
 * 401 or, for a limited IP, 429. See createDeployKeyAuthentication().
 * @type {function(Object, Object, Object): Promise<Object>}
 */
export const requireDeployKey = defaultAuthentication.requireDeployKey;

/**
 * The actor to record for something the deploy key did, such as creating a
 * Release.
 *
 * @param {Object} context - The request context; reads `env.DEPLOY_KEY_HASH`
 * @returns {DeployKeyActor}
 */
export function deployKeyActor(context) {
    const hash = context.env[DEPLOY_KEY_HASH_SECRET];
    const id = isNonEmptyString(hash) ? hash.slice(0, ACTOR_ID_LENGTH) : DEVELOPMENT_ACTOR_ID;

    return { type: 'deploy-key', id, name: 'Deploy key' };
}


// Hashes and compares only when there is both a stored hash and a credential.
async function presentsDeployKey(request, hash) {
    const credential = request.getAuthorizationBearer();

    if (!isNonEmptyString(hash) || credential === null) {
        return false;
    }

    return timingSafeEqual(await sha256Hex(credential), hash);
}

// A stored count is decimal text. Anything else counts as 0.
function parseCount(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 0;
}
