import {
    assert,
    assertNonEmptyString,
    isNonEmptyString,
} from '../assertions/mod.js';
import validatePathname, {
    isValidPathname,
} from '../utils/validate-pathname.js';


/**
 * Validates and folds a Hyperview storage identifier to its canonical form.
 * @param {string} value - Identifier to normalize
 * @returns {string} The validated identifier folded to lower case
 * @throws {BadRequestError} When value is not a valid pathname
 */
export function normalizeIdentifier(value) {
    return validatePathname(value).toLowerCase();
}

/**
 * Reports whether a value is a non-empty, valid, lower-case Hyperview identifier.
 * @param {*} value - Value to check
 * @returns {boolean} True when value is canonical
 */
export function isCanonicalIdentifier(value) {
    return isNonEmptyString(value) &&
        isValidPathname(value) &&
        value === value.toLowerCase();
}

/**
 * Asserts that a value is a canonical Hyperview storage identifier.
 * @param {*} value - Value to assert
 * @param {string} messagePrefix - Caller context included in assertion messages
 * @returns {void}
 * @throws {AssertionError} When value is empty, invalid, or not lower case
 */
export function assertCanonicalIdentifier(value, messagePrefix) {
    assertNonEmptyString(value, messagePrefix);
    assert(
        isValidPathname(value),
        `${ messagePrefix } must be a valid pathname`,
    );
    assert(
        value === value.toLowerCase(),
        `${ messagePrefix } must be lower case`,
    );
}
