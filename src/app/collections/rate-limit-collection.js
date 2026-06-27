import Collection from './base-key-value-store-collection.js';
import RateLimitRecord from './rate-limit-record.js';
import { assert, assertNonEmptyString } from '../../kixx/assertions/mod.js';


/**
 * @typedef {Object} RateLimitPolicy
 * @property {number} maxFailures - Failures within the window before the scope locks.
 * @property {number} windowSeconds - Sliding window length; the streak resets after this many seconds without a failure.
 * @property {number} cooldownSeconds - How long the scope stays locked once the threshold is reached.
 */

/**
 * @typedef {Object} RateLimitState
 * @property {boolean} throttled - True when the scope is currently locked.
 * @property {number} retryAfterSeconds - Whole seconds until the lock clears, or 0 when not throttled.
 */


/**
 * Table Data Gateway for fixed-window failure counters in the Key/Value Store.
 *
 * Each scope (a per-IP or per-(IP, email) key chosen by the caller) maps to one
 * counter record keyed by that scope id. The collection owns the counting and
 * lock-expiry mechanics; the caller supplies the policy so thresholds stay in
 * configuration rather than in storage code. The streak is a sliding window:
 * each failure refreshes the record TTL to `windowSeconds`, so a scope that
 * stops failing resets on its own, and a scope that crosses `maxFailures` is
 * locked for `cooldownSeconds` with a matching TTL so the lock self-clears.
 */
export default class RateLimitCollection extends Collection {

    static TYPE = 'RateLimit';

    static Record = RateLimitRecord;

    /**
     * Reads the current throttle state for a scope without recording a failure.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} scopeId - Opaque scope key identifying the counter record.
     * @returns {Promise<RateLimitState>} Current throttle state.
     * @throws {AssertionError} When scopeId is not a non-empty string.
     */
    async getState(context, scopeId) {
        assertNonEmptyString(scopeId, 'RateLimitCollection#getState() scopeId must be a non-empty string');

        const record = await this.get(context, scopeId);
        return toState(record);
    }

    /**
     * Records one failure for a scope and returns the resulting throttle state.
     *
     * Increments the counter within the current sliding window and locks the
     * scope for the cooldown once the configured threshold is reached. An
     * already-locked scope is left untouched, because callers check throttle
     * state before performing the protected work.
     *
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} scopeId - Opaque scope key identifying the counter record.
     * @param {RateLimitPolicy} policy - Threshold, window, and cooldown for this scope.
     * @returns {Promise<RateLimitState>} Throttle state after recording the failure.
     * @throws {AssertionError} When scopeId or any policy field is invalid.
     */
    async recordFailure(context, scopeId, policy) {
        assertNonEmptyString(scopeId, 'RateLimitCollection#recordFailure() scopeId must be a non-empty string');

        const { maxFailures, windowSeconds, cooldownSeconds } = policy ?? {};
        assert(
            Number.isInteger(maxFailures) && maxFailures > 0,
            'RateLimitCollection#recordFailure() policy.maxFailures must be a positive integer',
        );
        assert(
            Number.isInteger(windowSeconds) && windowSeconds > 0,
            'RateLimitCollection#recordFailure() policy.windowSeconds must be a positive integer',
        );
        assert(
            Number.isInteger(cooldownSeconds) && cooldownSeconds > 0,
            'RateLimitCollection#recordFailure() policy.cooldownSeconds must be a positive integer',
        );

        const now = new Date();
        const existing = await this.get(context, scopeId);

        // Already locked: the cooldown TTL clears the lock on its own, so leave the
        // record as-is and just report the current state.
        if (existing && existing.isLocked(now)) {
            return toState(existing, now);
        }

        const failureCount = (existing ? existing.get('failureCount') : 0) + 1;
        // Preserve the start of the current streak for diagnostics only; expiry is
        // driven by the TTL set below, not by this timestamp.
        const windowStartDate = existing ? existing.get('windowStartDate') : now.toISOString();

        let lockedUntilDate = null;
        let ttlSeconds = windowSeconds;

        if (failureCount >= maxFailures) {
            // Threshold reached: lock for the cooldown and match the TTL to it so
            // the record disappears exactly when the lock expires, with no
            // follow-up write needed to reset.
            lockedUntilDate = new Date(now.getTime() + (cooldownSeconds * 1000)).toISOString();
            ttlSeconds = cooldownSeconds;
        }

        // Read-modify-write on an eventually-consistent store with no concurrency
        // control: concurrent failures can lose an increment and slightly
        // undercount. That fail-soft behavior is acceptable for throttling and
        // avoids escalating to the document store's optimistic-concurrency path.
        const dto = await this.put(
            context,
            { id: scopeId, failureCount, windowStartDate, lockedUntilDate },
            { ttlSeconds },
        );

        return toState(dto, now);
    }

    /**
     * Deletes a scope's counter record, clearing any throttle.
     * @param {Object} context - Request or execution context passed through to the key/value store.
     * @param {string} scopeId - Opaque scope key identifying the counter record.
     * @returns {Promise<void>}
     * @throws {AssertionError} When scopeId is not a non-empty string.
     */
    async clear(context, scopeId) {
        assertNonEmptyString(scopeId, 'RateLimitCollection#clear() scopeId must be a non-empty string');

        await this.delete(context, scopeId);
    }
}

function toState(record, referenceDate = new Date()) {
    if (!record) {
        return { throttled: false, retryAfterSeconds: 0 };
    }

    const throttled = record.isLocked(referenceDate);
    return {
        throttled,
        retryAfterSeconds: throttled ? record.retryAfterSeconds(referenceDate) : 0,
    };
}
