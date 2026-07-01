import {
    isNonEmptyString,
    isString,
} from '../../../kixx/assertions/mod.js';

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

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
    if (value === null || value === undefined) {
        return null;
    }

    if (!isString(value)) {
        return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Adds a field error when an email address value is missing or malformed.
 * @param {import('../../kixx/errors/lib/validation-error.js').default} error - Validation error collector.
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
