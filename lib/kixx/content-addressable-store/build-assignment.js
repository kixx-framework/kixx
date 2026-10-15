import { isString } from '../assertions/mod.js';

const ASSIGNMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Recognizes server-generated UUID assignment identities, independent of content hashes.
 * @param {*} value - Value to check
 * @returns {boolean} Whether the value is a canonical version-4 UUID
 */
export function isValidAssignmentId(value) {
    return isString(value) && ASSIGNMENT_ID_PATTERN.test(value);
}
