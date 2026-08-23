import {
    assert,
    isString,
} from '../assertions/mod.js';

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
 * Reserved filename of an email assets bundle within its page directory.
 * @type {string}
 * @readonly
 */
export const EMAIL_ASSETS_BUNDLE = '__email-assets';

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
 * Reports whether a value satisfies ContentAddressableStore's canonical
 * pathname rules: lowercase, slash-separated, no `..` or `//` segments,
 * no segment starting with a dot, and no character outside the
 * filename-safe set. The empty string and root pathname `/` also
 * satisfy this rule; callers that must reject them use an
 * extended validation helper.
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
 * Folds a pathname to its canonical form: removes leading, trailing, and
 * consecutive slashes "/" before converting to lower case and adding a
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

/**
 * Reports whether a value is a canonical template filepath: it must satisfy
 * the canonical pathname rules and must name a non-root file, so a page
 * template can never resolve to the `/pages` namespace root.
 * @param {string} value - The filepath to check
 * @returns {boolean} True when the value is a valid, non-root template filepath
 */
export function isValidTemplateFilepath(value) {
    return isValidPathname(value) && normalizePathname(value) !== '/';
}

function getTemplatesPath(relativePathname) {
    return normalizePathname(`templates/${ relativePathname }`);
}

function getPagesPath(relativePathname) {
    return normalizePathname(`pages/${ relativePathname }`);
}

/**
 * Constructs the storage path for the a static asset.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/assets`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getStaticAssetPath(pathname) {
    assert(isValidPathname(pathname), 'getStaticAssetPath() requires a valid page pathname');
    return normalizePathname(`assets/${ pathname }`);
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
export function getGlobalTemplatePartialsPath() {
    return getTemplatesPath(TEMPLATE_PARTIALS_BUNDLE);
}

/**
 * Constructs the storage path for the root to a page's data.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPageDirectoryPath(pathname) {
    assert(isValidPathname(pathname), 'getPageDirectoryPath() requires a valid page pathname');
    return getPagesPath(pathname);
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
 * Constructs the storage path for a page's partials bundle file.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPagePartialsPath(pathname) {
    assert(isValidPathname(pathname), 'getPagePartialsPath() requires a valid page pathname');
    return getPagesPath(`${ pathname }/${ PAGE_PARTIALS_BUNDLE }`);
}

/**
 * Constructs the storage path for a page's includes bundle file.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPageIncludesPath(pathname) {
    assert(isValidPathname(pathname), 'getPageIncludesPath() requires a valid page pathname');
    return getPagesPath(`${ pathname }/${ PAGE_INCLUDES_BUNDLE }`);
}

/**
 * Constructs the storage path for a page's template file.
 * @param {string} pathname - Valid logical page pathname
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid page pathname
 */
export function getPageTemplatePath(pathname) {
    assert(isValidPathname(pathname), 'getPageTemplatePath() requires a valid page pathname');
    return getPagesPath(pathname);
}

export function isPageMetadataPath(pathname) {
    return pathname.startsWith('/pages') && pathname.endsWith('/page.json');
}

export function isPagePartialsPath(pathname) {
    return pathname.startsWith('/pages') && pathname.endsWith(`/${ PAGE_PARTIALS_BUNDLE }`);
}

export function isPageIncludesPath(pathname) {
    return pathname.startsWith('/pages') && pathname.endsWith(`/${ PAGE_INCLUDES_BUNDLE }`);
}

export function getEmailBundlePath(pathname) {
    assert(isValidPathname(pathname), 'getEmailBundlePath() requires a valid page pathname');
    return normalizePathname(`emails/${ EMAIL_ASSETS_BUNDLE }`);
}
