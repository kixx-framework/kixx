/**
 * Owns the Hyperview content model's pathname namespace: the `/templates` and
 * `/pages` roots, the reserved bundle filenames within them, the canonical
 * pathname rule, and the focused path constructors every Hyperview content
 * read and write goes through.
 *
 * This module intentionally duplicates the canonical-pathname algorithm that
 * `src/plugins/cloudflare-content-addressable-store/lib/addressing.js` also
 * implements. The two are not the same rule wearing two names: Hyperview owns
 * the canonical pathname rule and the namespace layout built on it, while the
 * adapter keeps only a defensive copy that guards its own storage-key space.
 * Neither imports the other, and neither imports the unrelated, expected-to-be
 * deprecated `src/kixx/utils/validate-pathname.js`.
 *
 * @module kixx/hyperview/content-layout
 */

import { assert, isString } from '../assertions/mod.js';


// Path segments are restricted to a conservative filename-safe set. Anything
// outside it (path separators beyond the segment split, query/fragment
// characters, whitespace, shell or URL metacharacters) is rejected before the
// pathname is used to construct a storage read or write.
const DISALLOWED_PATHNAME_CHARACTERS = /[^a-z0-9_.-]/i;

/**
 * Reserved filename of the base-template bundle within the templates namespace.
 * @type {string}
 * @readonly
 */
export const BASE_TEMPLATES_BUNDLE = '__base-templates-bundle';

/**
 * Reserved filename of the global partial-template bundle within the templates namespace.
 * @type {string}
 * @readonly
 */
export const TEMPLATE_PARTIALS_BUNDLE = '__template-partials-bundle';

/**
 * Reserved filename of a page's partial-template bundle within its page directory.
 * @type {string}
 * @readonly
 */
export const PAGE_PARTIALS_BUNDLE = '__page-partials-bundle';

/**
 * Reserved filename of a page's include bundle within its page directory.
 * @type {string}
 * @readonly
 */
export const PAGE_INCLUDES_BUNDLE = '__page-includes-bundle';

/**
 * Filenames a page directory reserves for its own bundles. A page template
 * filename must not collide with one of these.
 * @type {Set<string>}
 * @readonly
 */
export const RESERVED_PAGE_FILENAMES = new Set([
    'page.json',
    PAGE_PARTIALS_BUNDLE,
    PAGE_INCLUDES_BUNDLE,
]);

/**
 * Reports whether a value satisfies Hyperview's canonical pathname rule:
 * lowercase, slash-separated, no `..` or `//` segments, no segment starting
 * with a dot, and no character outside the filename-safe set. The empty
 * string satisfies this rule; callers that must reject an absent identifier
 * check for content separately (see `HyperviewService#assertCanonicalIdentifier()`).
 * The root page pathname `/` also satisfies this rule.
 * @param {string} pathname - The pathname to check
 * @returns {boolean} True when the pathname is valid
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
 * Reports whether a value is a canonical Hyperview template filepath: it must
 * satisfy the canonical pathname rule and must name a non-root file, so a page
 * template can never resolve to the `/pages` namespace root.
 * @param {string} value - The filepath to check
 * @returns {boolean} True when the value is a valid, non-root template filepath
 */
export function isValidTemplateFilepath(value) {
    return isValidPathname(value) && normalizePathname(value) !== '/';
}

/**
 * Folds a Hyperview pathname to its canonical form: removes leading, trailing,
 * and consecutive slashes "/" before converting to lower case and adding a
 * single leading slash.
 * @param {string} value - Identifier to normalize
 * @returns {string} The identifier folded to canonical form
 * @throws {TypeError} When value is not a string
 */
export function normalizePathname(value) {
    if (!isString(value)) {
        throw new TypeError('An identifier must be a string');
    }

    const id = value.split('/')
        .filter((part) => part)
        .join('/')
        .toLowerCase();

    return '/' + id;
}

function getTemplatesPath(relativePathname) {
    return normalizePathname(`templates/${ relativePathname }`);
}

function getPagesPath(relativePathname) {
    return normalizePathname(`pages/${ relativePathname }`);
}

/**
 * Constructs the storage path for the base-template bundle.
 * @returns {string} Canonical pathname beneath `/templates`
 */
export function getBaseTemplatesPath() {
    return getTemplatesPath(BASE_TEMPLATES_BUNDLE);
}

/**
 * Constructs the storage path for the global partial-template bundle.
 * @returns {string} Canonical pathname beneath `/templates`
 */
export function getTemplatePartialsPath() {
    return getTemplatesPath(TEMPLATE_PARTIALS_BUNDLE);
}

/**
 * Constructs the storage path for a page's metadata file.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPageMetadataPath(pathname) {
    assert(isValidPathname(pathname), 'getPageMetadataPath() requires a valid page pathname');
    return getPagesPath(`${ pathname }/page.json`);
}

/**
 * Constructs the storage path for a page's partial-template bundle.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPagePartialsPath(pathname) {
    assert(isValidPathname(pathname), 'getPagePartialsPath() requires a valid page pathname');
    return getPagesPath(`${ pathname }/${ PAGE_PARTIALS_BUNDLE }`);
}

/**
 * Constructs the storage path for a page's include bundle.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPageIncludesPath(pathname) {
    assert(isValidPathname(pathname), 'getPageIncludesPath() requires a valid page pathname');
    return getPagesPath(`${ pathname }/${ PAGE_INCLUDES_BUNDLE }`);
}

/**
 * Constructs the storage path for a page-template source file.
 * @param {string} filepath - Valid, non-root template filepath
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When filepath is not a valid, non-root template filepath
 */
export function getPageTemplatePath(filepath) {
    assert(isValidTemplateFilepath(filepath), 'getPageTemplatePath() requires a valid template filepath');
    return getPagesPath(filepath);
}
