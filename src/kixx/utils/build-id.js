import { isNonEmptyString } from '../assertions/mod.js';
import { BadRequestError } from '../errors/mod.js';

import { isValidPathname } from './validate-pathname.js';


// This URL-safe segment represents the flat static-file-store root when a
// deployment has no Build ID. Hyperview writes it into asset URLs and the
// static asset handler maps it back to a null namespace.
export const NO_BUILD_ID_SEGMENT = 'dev';

/**
 * Reports whether a value is a real Build ID that can occupy one URL segment.
 * @param {*} value - Candidate Build ID.
 * @returns {boolean} True for a non-empty, safe, non-reserved Build ID.
 */
export function isValidBuildId(value) {
    return isNonEmptyString(value)
        && !value.includes('/')
        && value !== NO_BUILD_ID_SEGMENT
        && isValidPathname(value);
}

/**
 * Validates an externally supplied real Build ID without changing its case.
 * @param {*} value - Candidate Build ID.
 * @returns {string} The validated Build ID.
 * @throws {BadRequestError} When value is reserved or is not a safe Build ID.
 */
export function validateBuildId(value) {
    if (value === NO_BUILD_ID_SEGMENT) {
        throw new BadRequestError('The Build ID "dev" is reserved for no-build asset URLs.', {
            code: 'ReservedBuildId',
        });
    }

    if (!isValidBuildId(value)) {
        throw new BadRequestError('Build ID must be one safe, non-empty URL path segment.', {
            code: 'InvalidBuildId',
        });
    }

    return value;
}
