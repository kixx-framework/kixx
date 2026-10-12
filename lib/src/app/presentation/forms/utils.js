import {
    isNonEmptyString,
    isUndefined,
    isString,
} from '../../../kixx/assertions/mod.js';

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const INTEGER_STRING_PATTERN = /^[0-9]+$/u;

/**
 * Trims a submitted string field while preserving missing or non-string values.
 * @param {*} value - Submitted field value.
 * @returns {*} Trimmed string when value is a non-empty string, otherwise the original value.
 */
export function normalizeStringAttribute(value) {
    if (isNonEmptyString(value)) {
        return value.trim();
    }
    return value;
}

/**
 * Preserves a submitted secret string exactly as entered.
 * @param {*} value - Submitted field value.
 * @returns {*} Primitive string when value is string-like, otherwise the original value.
 */
export function normalizeSecretStringAttribute(value) {
    if (isString(value)) {
        return String(value);
    }
    return value;
}

/**
 * Trims and lowercases a submitted string field while preserving missing or non-string values.
 * @param {*} value - Submitted field value.
 * @returns {*} Lowercase trimmed string when value is a non-empty string, otherwise the original value.
 */
export function normalizeLowerCaseStringAttribute(value) {
    if (isNonEmptyString(value)) {
        return value.trim().toLowerCase();
    }
    return value;
}

/**
 * Trims a submitted optional string field, collapsing absence and blank input to null.
 * @param {*} value - Submitted field value.
 * @returns {*} Trimmed non-empty string, null when value is missing or blank, otherwise the original value.
 */
export function normalizeOptionalStringAttribute(value) {
    if (value === null || isUndefined(value)) {
        return null;
    }

    if (!isString(value)) {
        return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses a submitted whole-number field, such as a select of lifetimes in seconds.
 *
 * Missing and blank input take the default. A string that is not entirely
 * digits is returned trimmed rather than parsed, because Number.parseInt()
 * accepts partial numbers like "604800abc"; validate() then reports it. The
 * raw string (not Number.NaN) is kept because it round-trips through
 * getFormContext()'s echoed field value into response props, which must stay
 * JSON-canonicalizable for the page cache key.
 *
 * @param {*} value - Submitted field value.
 * @param {number} defaultValue - Value used when the field is missing or blank.
 * @returns {*} Parsed integer, the default, or the original non-integer value.
 */
export function normalizeIntegerStringAttribute(value, defaultValue) {
    if (value === null || isUndefined(value)) {
        return defaultValue;
    }

    if (!isString(value)) {
        return value;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return defaultValue;
    }

    if (!INTEGER_STRING_PATTERN.test(trimmed)) {
        return trimmed;
    }

    return Number.parseInt(trimmed, 10);
}

/**
 * Adds a field error when an email address value is missing or malformed.
 * @param {import('../../../kixx/errors/lib/validation-error.js').default} error - Validation error collector.
 * @param {*} value - Normalized field value.
 * @param {string} name - Field name used as the error source.
 * @returns {void}
 */
export function validateEmailAddressField(error, value, name) {
    if (!isNonEmptyString(value)) {
        error.push('Email address is required', name);
    } else if (!EMAIL_ADDRESS_PATTERN.test(value)) {
        error.push('Email address must be valid', name);
    }
}
