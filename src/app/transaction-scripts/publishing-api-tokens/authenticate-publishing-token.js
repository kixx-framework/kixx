import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import {
    AssertionError,
    ForbiddenError,
    UnauthenticatedError,
} from '../../../kixx/errors/mod.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';


const UNAUTHENTICATED_MESSAGE = 'Publishing API authentication is required.';
const INACTIVE_TOKEN_MESSAGE = 'The publishing API token is expired or revoked.';


/**
 * Authenticates a Publishing API bearer token.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} token - Raw bearer token presented by the request.
 * @returns {Promise<import('../../collections/publishing-api-token-record.js').default>} Active token record.
 * @throws {UnauthenticatedError} When the token is missing or unknown.
 * @throws {ForbiddenError} When the token is expired or revoked.
 * @throws {AssertionError} When an unexpected storage failure occurs.
 */
export async function authenticatePublishingToken(context, token) {
    if (!isNonEmptyString(token)) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    const tokenHash = await sha256Hex(token);
    const publishingApiTokens = context.getCollection('PublishingApiToken');

    let record;
    try {
        record = await publishingApiTokens.getByTokenHash(context, tokenHash);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading a publishing API token', { cause });
    }

    if (!record) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    if (!record.isActive()) {
        throw new ForbiddenError(INACTIVE_TOKEN_MESSAGE, {
            code: 'PublishingApiTokenInactive',
        });
    }

    return record;
}
