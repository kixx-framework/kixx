import {
    assert,
    assertNonEmptyString,
    isString,
    isUndefined,
    isNonEmptyString,
} from '../assertions/mod.js';


// Path segments are restricted to a conservative filename-safe set. Anything
// outside it (path separators beyond the segment split, query/fragment
// characters, whitespace, shell or URL metacharacters) is rejected before the
// path reaches a storage adapter or static file store.
const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;


/**
 * Reports whether a URL or logical pathname contains only safe path segments.
 * @param {string} pathname - The pathname to check
 * @returns {boolean} True when the pathname is valid
 */
export function isValidPathname(pathname) {
    // Two dots or two slashes are always invalid.
    if (pathname.includes('..') || pathname.includes('//')) {
        return false;
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        // A leading dot on any segment (dotfiles, `.` itself) is rejected in
        // addition to the disallowed-character check.
        if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
            return false;
        }
    }

    return true;
}

/**
 * Folds a ContentAddressableStore identifier to its canonical form, removing
 * leading, trailing, and consecutive slashes "/" before converting
 * to lower case. If the passed value is not a non-empty string
 * then it is simply returned without modification.
 * @param {*} value - Identifier to normalize
 * @returns {string} The validated identifier folded to lower case
 */
export function normalizeIdentifier(value) {
    if (value === '' || value === null || isUndefined(value)) {
        return '';
    }
    if (!isString(value)) {
        throw new TypeError('An identifier must be a string');
    }

    // Remove leading, trailing, and multiple consecutive slashes ("/") and
    // convert to lower case.
    const parts = value.split('/').filter((part) => part);
    return parts.join('/').toLowerCase();
}

/**
 * Asserts that a value is a canonical ContentAddressableStore identifier.
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
