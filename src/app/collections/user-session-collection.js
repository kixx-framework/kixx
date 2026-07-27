import { generateSecretToken } from '../../kixx/utils/crypto.js';
import Collection from './base-key-value-store-collection.js';
import UserSessionRecord from './user-session-record.js';
import { assert, assertNonEmptyString } from '../../kixx/assertions/mod.js';


/**
 * Table Data Gateway for authenticated admin user sessions in the Key/Value Store.
 *
 * Each session has both a store TTL for automatic cleanup and an embedded
 * expiration timestamp used to enforce expiry when authenticating.
 * @extends Collection
 */
export default class UserSessionCollection extends Collection {

    static TYPE = 'UserSession';

    static Record = UserSessionRecord;

    generateUniqueId() {
        return generateSecretToken();
    }

    /**
     * Creates an expiring session for an authenticated admin user.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} userId - AdminUser record id authenticated by the session.
     * @param {number} ttlSeconds - Session lifetime in seconds.
     * @returns {Promise<UserSessionRecord>} The stored user session record.
     * @throws {AssertionError} When userId is empty or ttlSeconds is not an integer of at least 60.
     * @throws {ValidationError} When the generated record fails validation.
     */
    async createForUser(context, userId, ttlSeconds) {
        assertNonEmptyString(
            userId,
            'UserSessionCollection#createForUser() userId must be a non-empty string',
        );
        assert(
            Number.isInteger(ttlSeconds) && ttlSeconds >= 60,
            'UserSessionCollection#createForUser() ttlSeconds must be an integer of at least 60',
        );

        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = nowSeconds + ttlSeconds;
        const expirationDate = new Date(expiresAt * 1000);

        const session = {
            userId,
            sessionCreationDate: new Date().toISOString(),
            sessionExpirationDate: expirationDate.toISOString(),
        };

        return await this.put(context, session, { expiresAt });
    }
}
