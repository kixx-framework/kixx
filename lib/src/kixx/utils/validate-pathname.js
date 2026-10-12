import { BadRequestError } from '../errors/mod.js';


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
 * Validates a URL or logical pathname for safe path segments, rejecting path
 * traversal and disallowed characters before the path reaches a storage adapter
 * or static file store. Shared by the Hyperview page request handlers, the
 * template upload handlers, and the static file server so the path-safety rule
 * lives in one place.
 * @param {string} pathname - The pathname to validate
 * @returns {string} The validated pathname, returned unchanged
 * @throws {BadRequestError} When the pathname contains `..` or `//`, a segment
 *   starting with `.`, or a character outside `[a-z0-9_.-]`
 */
export default function validatePathname(pathname) {
    if (!isValidPathname(pathname)) {
        throw new BadRequestError(`Invalid pathname: ${ pathname }`);
    }

    return pathname;
}
