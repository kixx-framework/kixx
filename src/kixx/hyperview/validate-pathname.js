import { BadRequestError } from '../errors/mod.js';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;

/**
 * Validates a URL or logical pathname for safe path segments, rejecting path
 * traversal and disallowed characters. Shared by the page request handlers and
 * the template upload handlers so the path-safety rule lives in one place.
 * @param {string} pathname - The pathname to validate
 * @returns {string} The validated pathname, returned unchanged
 * @throws {BadRequestError} When the pathname contains `..` or `//`, a segment
 *   starting with `.`, or a character outside `[a-z0-9_.-]`
 */
export default function validatePathname(pathname) {
    // Two dots or two slashes are always invalid
    if (pathname.includes('..') || pathname.includes('//')) {
        throw new BadRequestError(`Invalid pathname: ${ pathname }`);
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        // In addition to the pattern list, a single dot at the start of
        // a path part is invalid.
        if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
            throw new BadRequestError(`Invalid pathname: ${ pathname }`);
        }
    }

    return pathname;
}
