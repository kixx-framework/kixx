import { generateSecretToken, sha256Hex } from '../lib/crypto.js';
import Collection from './base-key-value-store-collection.js';
import CsrfTokenRecord from './csrf-token-record.js';
import { assert, assertNonEmptyString, isNonEmptyString } from '../../kixx/assertions/mod.js';


export default class CsrfTokenCollection extends Collection {

    static TYPE = 'CsrfToken';

    static Record = CsrfTokenRecord;

    generateUniqueId() {
        return generateSecretToken();
    }

    /**
     * Creates a CSRF pre-session record and returns the one-time plaintext token for form rendering.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {number} ttlSeconds - Token lifetime in seconds.
     * @returns {Promise<{ csrfSessionId: string, token: string, record: CsrfTokenRecord }>}
     * @throws {AssertionError} When ttlSeconds is not a positive integer.
     * @throws {ValidationError} When the generated record fails validation.
     */
    async createToken(context, ttlSeconds) {
        assert(
            Number.isInteger(ttlSeconds) && ttlSeconds > 0,
            'CsrfTokenCollection#createToken() ttlSeconds must be a positive integer',
        );

        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = nowSeconds + ttlSeconds;
        const token = generateSecretToken();
        const tokenHash = await sha256Hex(token);
        const record = await this.put(
            context,
            {
                tokenHash,
                tokenCreationDate: new Date(nowSeconds * 1000).toISOString(),
                tokenExpirationDate: new Date(expiresAt * 1000).toISOString(),
            },
            { expiresAt },
        );

        return {
            csrfSessionId: record.id,
            token,
            record,
        };
    }

    /**
     * Loads a CSRF token record by browser pre-session id.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} csrfSessionId - CSRF pre-session identifier from the browser cookie.
     * @returns {Promise<CsrfTokenRecord|null>} Stored record, or null when absent or expired by the key/value store.
     * @throws {AssertionError} When csrfSessionId is not a non-empty string.
     */
    async getBySessionId(context, csrfSessionId) {
        assertNonEmptyString(
            csrfSessionId,
            'CsrfTokenCollection#getBySessionId() csrfSessionId must be a non-empty string',
        );

        return await this.get(context, csrfSessionId);
    }

    /**
     * Validates a submitted CSRF token against the stored token hash.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} csrfSessionId - CSRF pre-session identifier from the browser cookie.
     * @param {string} token - Plaintext token submitted from the protected form.
     * @returns {Promise<boolean>} True only when the record exists, is not expired, and the token hash matches.
     */
    async validateToken(context, csrfSessionId, token) {
        if (!isNonEmptyString(csrfSessionId) || !isNonEmptyString(token)) {
            return false;
        }

        const record = await this.get(context, csrfSessionId);
        if (!record || record.isExpired()) {
            return false;
        }

        const tokenHash = await sha256Hex(token);
        return record.get('tokenHash') === tokenHash;
    }

    /**
     * Deletes a CSRF token record by browser pre-session id.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} csrfSessionId - CSRF pre-session identifier from the browser cookie.
     * @returns {Promise<void>}
     * @throws {AssertionError} When csrfSessionId is not a non-empty string.
     */
    async deleteToken(context, csrfSessionId) {
        assertNonEmptyString(
            csrfSessionId,
            'CsrfTokenCollection#deleteToken() csrfSessionId must be a non-empty string',
        );

        await this.delete(context, csrfSessionId);
    }
}
