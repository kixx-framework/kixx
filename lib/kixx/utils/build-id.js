import { isNonEmptyString } from '../assertions/mod.js';
import { BadRequestError } from '../errors/mod.js';

import { isValidPathname } from './validate-pathname.js';


/**
 * Reports whether a value is a real Build ID that can occupy one URL segment.
 * @param {*} value - Candidate Build ID.
 * @returns {boolean} True for a non-empty, safe Build ID.
 */
export function isValidBuildId(value) {
    return isNonEmptyString(value)
        && !value.includes('/')
        && isValidPathname(value);
}

/**
 * Validates an externally supplied real Build ID without changing its case.
 * @param {*} value - Candidate Build ID.
 * @returns {string} The validated Build ID.
 * @throws {BadRequestError} When value is not a safe Build ID.
 */
export function validateBuildId(value) {
    if (!isValidBuildId(value)) {
        throw new BadRequestError('Build ID must be one safe, non-empty URL path segment.', {
            code: 'InvalidBuildId',
        });
    }

    return value;
}
