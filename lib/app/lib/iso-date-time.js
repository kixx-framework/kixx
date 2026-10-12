import { isNonEmptyString, isValidDate } from '../../kixx/assertions/mod.js';


const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;


/**
 * Parses a timezone-bearing ISO date-time string.
 * @param {*} value - Candidate ISO date-time string.
 * @returns {Date|null} Parsed Date, or null when the value is malformed or invalid.
 */
export function parseIsoDateTime(value) {
    if (!isNonEmptyString(value) || !ISO_DATE_TIME_PATTERN.test(value)) {
        return null;
    }

    const date = new Date(value);
    return isValidDate(date) ? date : null;
}

/**
 * Reports whether a value is a timezone-bearing, parseable ISO date-time string.
 * @param {*} value - Value to inspect.
 * @returns {boolean} True when the value satisfies the ISO date-time contract.
 */
export function isIsoDateTime(value) {
    return parseIsoDateTime(value) !== null;
}
