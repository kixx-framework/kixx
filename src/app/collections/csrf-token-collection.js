import { generateSecretToken, sha256Hex } from '../../kixx/utils/crypto.js';
import Collection from './base-key-value-store-collection.js';
import CsrfTokenRecord, { MIN_REUSABLE_SECONDS } from './csrf-token-record.js';
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
     * @throws {AssertionError} When ttlSeconds is shorter than MIN_REUSABLE_SECONDS.
     * @throws {ValidationError} When the generated record fails validation.
     */
    async createToken(context, ttlSeconds) {
        assert(
            Number.isInteger(ttlSeconds) && ttlSeconds >= MIN_REUSABLE_SECONDS,
            `CsrfTokenCollection#createToken() ttlSeconds must be an integer of at least ${ MIN_REUSABLE_SECONDS }`,
        );

        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = nowSeconds + ttlSeconds;
        const token = generateSecretToken();
        const tokenHash = await sha256Hex(token);
        const record = await this.put(
            context,
            {
                tokenHashes: [ tokenHash ],
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
     * Mints an additional token inside an existing, unexpired pre-session.
     *
     * Every token already live in the record stays valid, so rendering a form in a
     * second tab — or re-rendering the same page — cannot kill the forms a browser
     * is already holding. The pre-session deadline is not extended: the rewritten
     * entry keeps the expiration the pre-session was born with.
     *
     * Two renders racing on the same pre-session can lose one appended digest,
     * because the key/value store has no compare-and-set; the loser's form then
     * reads as expired. That is a narrow race against what is otherwise guaranteed
     * breakage on every second render.
     *
     * Callers must confirm the pre-session is still worth writing to with
     * `CsrfTokenRecord#isReusable()` and start a new one otherwise. A pre-session
     * below that threshold cannot be rewritten.
     *
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {CsrfTokenRecord} record - Reusable pre-session previously loaded from this collection.
     * @returns {Promise<{ csrfSessionId: string, token: string, record: CsrfTokenRecord }>}
     * @throws {AssertionError} When the pre-session has too little lifetime left to rewrite.
     * @throws {ValidationError} When the updated record fails validation.
     */
    async issueToken(context, record) {
        assert(
            record.isReusable(),
            'CsrfTokenCollection#issueToken() requires a pre-session with remaining lifetime',
        );

        const token = generateSecretToken();
        const tokenHash = await sha256Hex(token);

        record.addTokenHash(tokenHash);

        const saved = await this.put(context, record, {
            expiresAt: record.getExpirationUnixSeconds(),
        });

        return {
            csrfSessionId: saved.id,
            token,
            record: saved,
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
     * @returns {Promise<boolean>} True only when the record exists, is not expired, and holds the submitted token.
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
        return record.hasTokenHash(tokenHash);
    }

    /**
     * Spends one token, leaving the pre-session's other live tokens usable.
     *
     * Deleting the whole pre-session here would defeat the point of holding several
     * tokens, so only the submitted one is dropped. Spending the last token ends the
     * pre-session outright, because a record with no tokens can validate nothing.
     *
     * A pre-session too close to its deadline to rewrite is also ended rather than
     * left alone: the store would reject the write, and skipping it would leave the
     * token that was just spent replayable for as long as the record survives.
     * Other tabs lose their tokens a minute or two early, which is what expiry was
     * about to do anyway.
     *
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} csrfSessionId - CSRF pre-session identifier from the browser cookie.
     * @param {string} token - Plaintext token that was just accepted.
     * @returns {Promise<void>}
     * @throws {AssertionError} When csrfSessionId is not a non-empty string.
     */
    async consumeToken(context, csrfSessionId, token) {
        assertNonEmptyString(
            csrfSessionId,
            'CsrfTokenCollection#consumeToken() csrfSessionId must be a non-empty string',
        );

        const record = await this.get(context, csrfSessionId);

        // Already gone (expired by the store, or cleared by a concurrent request):
        // nothing to spend, and no reason to fail the caller's request.
        if (!record) {
            return;
        }

        record.removeTokenHash(await sha256Hex(token));

        if (record.getTokenHashes().length === 0 || !record.isReusable()) {
            await this.delete(context, csrfSessionId);
            return;
        }

        await this.put(context, record, {
            expiresAt: record.getExpirationUnixSeconds(),
        });
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
