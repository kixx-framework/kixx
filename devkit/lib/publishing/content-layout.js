import { isString } from '../vendor/kixx-assert/mod.js';

/**
 * @module publishing/content-layout
 *
 * Logical pathname rules ported from
 * repo `lib/kixx/content-addressable-store/content-layout.js` at
 * addressing `FORMAT = 4`. Storage path builders are intentionally absent:
 * the Publishing API accepts logical pathnames.
 */

const DISALLOWED_PATHNAME_CHARACTERS = /[^a-z0-9_.-]/i;

/**
 * Filenames reserved for page metadata and generated page bundles.
 * @type {Set<string>}
 * @readonly
 */
export const RESERVED_PAGE_FILENAMES = new Set([
    'page.json',
    '__page-partials-bundle',
    '__page-includes-bundle',
]);

/**
 * Reports whether a value satisfies the framework's logical pathname rules.
 * @param {string} pathname - Pathname to check
 * @returns {boolean} True when pathname is canonical and safe
 */
export function isValidPathname(pathname) {
    if (!isString(pathname)) {
        return false;
    }

    if (pathname.includes('..') || pathname.includes('//')) {
        return false;
    }

    if (pathname.toLowerCase() !== pathname) {
        return false;
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        if (part.startsWith('.') || DISALLOWED_PATHNAME_CHARACTERS.test(part)) {
            return false;
        }
    }

    return true;
}

/**
 * Folds a pathname to the framework's canonical form.
 * @param {string} value - Pathname to normalize
 * @returns {string} Lowercase pathname with one leading slash
 * @throws {TypeError} When value is not a string
 */
export function normalizePathname(value) {
    if (!isString(value)) {
        throw new TypeError('An identifier must be a string');
    }

    const pathname = value.split('/')
        .filter((part) => part)
        .join('/')
        .toLowerCase();

    return '/' + pathname;
}

/**
 * Reports whether a value names a non-root, non-reserved page template file.
 * @param {string} value - Template filepath to check
 * @returns {boolean} True when the filepath can identify a page template
 */
export function isValidTemplateFilepath(value) {
    if (!isValidPathname(value) || normalizePathname(value) === '/') {
        return false;
    }

    const filename = normalizePathname(value).split('/').pop();
    return !RESERVED_PAGE_FILENAMES.has(filename);
}
