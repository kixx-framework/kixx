import Record from './base-key-value-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { assert, isNumberNotNaN, isValidDate } from '../../kixx/assertions/mod.js';
import { isIsoDateTime, parseIsoDateTime } from '../lib/iso-date-time.js';


/**
 * Key/Value Store record holding the failure counter and lock state for one
 * rate-limit scope.
 *
 * The record id is the opaque scope key supplied by the caller (for example a
 * per-IP or per-(IP, email) key); this class owns only the counter shape and
 * the lock-expiry math. Throttling policy (thresholds, window, cooldown) lives
 * with the caller, not on the record.
 * @extends Record
 */
export default class RateLimitRecord extends Record {

    /**
     * Reference schema for persisted rate-limit counter attributes.
     * @type {Object}
     */
    static schema = {
        type: 'object',
        properties: {
            failureCount: {
                type: 'number',
                description: 'Number of failures accumulated in the current window',
            },
            windowStartDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp of the first failure in the current streak; diagnostic only, expiry is TTL-driven',
            },
            lockedUntilDate: {
                type: [ 'string', 'null' ],
                format: 'date-time',
                description: 'ISO timestamp until which the scope is throttled, or null while still under the threshold',
            },
        },
        required: [ 'failureCount', 'windowStartDate', 'lockedUntilDate' ],
    };

    /**
     * Validates the failure counter and lock timestamps before persistence.
     * @returns {void}
     * @throws {ValidationError} When one or more counter attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid rate limit record');

        if (!isNumberNotNaN(this.get('failureCount'))) {
            error.push('RateLimit failureCount is required', 'failureCount');
        }

        if (!isIsoDateTime(this.get('windowStartDate'))) {
            error.push('RateLimit windowStartDate is required', 'windowStartDate');
        }

        // lockedUntilDate is optional, but when present it must be a parseable
        // ISO timestamp so isLocked() can compare it against the current time.
        const lockedUntilDate = this.get('lockedUntilDate');
        if (lockedUntilDate !== null &&
            lockedUntilDate !== undefined &&
            !isIsoDateTime(lockedUntilDate)) {
            error.push('RateLimit lockedUntilDate must be an ISO date or null', 'lockedUntilDate');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Increments this scope's failure counter in place.
     * @returns {number} The incremented failure count.
     */
    incrementFailureCount() {
        const failureCount = this.get('failureCount') + 1;
        this.set('failureCount', failureCount);
        return failureCount;
    }

    /**
     * Reports whether the scope is currently locked (throttled).
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True when a lock is set and still in the future.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isLocked(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'RateLimitRecord#isLocked() referenceDate must be a valid Date');

        const lockedUntilDate = parseIsoDateTime(this.get('lockedUntilDate'));
        return lockedUntilDate !== null &&
            lockedUntilDate.getTime() > referenceDate.getTime();
    }

    /**
     * Seconds remaining until the lock expires, rounded up. Returns 0 when not locked.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {number} Whole seconds the caller should ask the user to wait.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    retryAfterSeconds(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'RateLimitRecord#retryAfterSeconds() referenceDate must be a valid Date');

        const lockedUntilDate = parseIsoDateTime(this.get('lockedUntilDate'));
        if (!lockedUntilDate) {
            return 0;
        }

        const remainingMs = lockedUntilDate.getTime() - referenceDate.getTime();
        return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    }
}
