import { isString } from './vendor/kixx-assert/mod.js';


/**
 * Parses an HTTP `Retry-After` header value into a delay in milliseconds.
 *
 * Accepts both forms from RFC 9110: delay-seconds (a non-negative integer)
 * and an HTTP-date. A date in the past means no delay. No cap is applied;
 * how long to actually wait is the caller's policy.
 *
 * @param {?string} value - Raw header value, or null/undefined when absent
 * @param {number} nowMs - Current time in epoch milliseconds, for the HTTP-date form
 * @returns {?number} Delay in milliseconds (>= 0), or null when the value is absent or invalid
 */
export function parseRetryAfter(value, nowMs) {
    if (!isString(value)) {
        return null;
    }

    const trimmed = value.trim();

    if (trimmed === '') {
        return null;
    }

    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed) * 1000;
    }

    // Reject numeric-looking values ("-1", "1.5") that Date.parse would
    // otherwise accept as dates.
    if (/^[-+\d.\s]+$/.test(trimmed)) {
        return null;
    }

    const date = Date.parse(trimmed);

    if (Number.isNaN(date)) {
        return null;
    }

    return Math.max(0, date - nowMs);
}
