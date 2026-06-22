import { BadRequestError } from '../errors/mod.js';


// Static file path segments are restricted to a conservative filename-safe set.
// Anything outside it (path separators beyond the segment split, query/fragment
// characters, whitespace, shell or URL metacharacters) is rejected before the
// path reaches a storage adapter.
const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;

/**
 * Validates a public-root-relative file pathname for safe path segments, rejecting
 * path traversal and disallowed characters before it reaches a static file store
 * adapter.
 *
 * This intentionally duplicates the path-safety rule used by the Hyperview request
 * handlers (`kixx/hyperview/validate-pathname.js`) rather than importing it, so the
 * static file server does not depend on the Hyperview module. If a third consumer
 * appears, hoist a single shared path-safety utility instead of copying it again.
 * @param {string} pathname - The pathname to validate, relative to the public root.
 * @returns {string} The validated pathname, returned unchanged.
 * @throws {BadRequestError} When the pathname contains `..` or `//`, a segment
 *   starting with `.`, or a character outside `[a-z0-9_.-]`.
 */
export default function validatePathname(pathname) {
    // Two dots or two slashes are always invalid.
    if (pathname.includes('..') || pathname.includes('//')) {
        throw new BadRequestError(`Invalid pathname: ${ pathname }`);
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        // A leading dot on any segment (dotfiles, `.` itself) is rejected in
        // addition to the disallowed-character check.
        if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
            throw new BadRequestError(`Invalid pathname: ${ pathname }`);
        }
    }

    return pathname;
}
