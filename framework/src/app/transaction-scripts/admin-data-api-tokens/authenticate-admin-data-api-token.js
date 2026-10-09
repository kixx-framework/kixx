import { AssertionError, UnauthenticatedError } from '../../../kixx/errors/mod.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';
import { ADMIN_DATA_API_TOKEN_PREFIX } from '../../collections/admin-data-api-token-collection.js';


const UNAUTHENTICATED_MESSAGE = 'Admin data API authentication is required.';
const INACTIVE_TOKEN_MESSAGE = 'The admin data API token is expired or revoked.';

// A minted token is the prefix followed by 32 random bytes as lowercase hex.
const TOKEN_PATTERN = new RegExp(`^${ ADMIN_DATA_API_TOKEN_PREFIX }[0-9a-f]{64}$`);


/**
 * Authenticates an Administrative Data API bearer token against current
 * stored state. Nothing is cached, so a revocation takes effect for every
 * request that authenticates after it is stored.
 *
 * Every rejection is a 401: unlike the Publishing API, an expired or revoked
 * token here is a failed authentication, not an authorization denial, so a
 * client always re-credentials rather than retrying.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string|null} token - Raw bearer token presented by the request.
 * @returns {Promise<import('../../collections/admin-data-api-token-record.js').default>} Active token record.
 * @throws {UnauthenticatedError} When the token is missing, malformed, unknown, expired, or revoked.
 * @throws {AssertionError} When an unexpected storage failure occurs.
 */
export async function authenticateAdminDataApiToken(context, token) {
    // Rejecting other shapes before lookup keeps Publishing API tokens and any
    // other credential out of this domain even if a hash were ever to collide.
    if (!TOKEN_PATTERN.test(token ?? '')) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    const tokenHash = await sha256Hex(token);
    const tokens = context.getCollection('AdminDataApiToken');

    let record;
    try {
        record = await tokens.getByTokenHash(context, tokenHash);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin data API token', { cause });
    }

    if (!record) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    if (!record.isActive()) {
        throw new UnauthenticatedError(INACTIVE_TOKEN_MESSAGE, {
            code: 'AdminDataApiTokenInactive',
        });
    }

    return record;
}
