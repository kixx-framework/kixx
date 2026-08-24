import {
    assert,
    isString,
} from '../assertions/mod.js';

/**
 * @module content-layout
 *
 * The naming rules for the content-addressable index: what a pathname is
 * allowed to look like, and where each kind of content lives inside it.
 *
 * The index is one flat table keyed by pathname, so the namespaces below are a
 * convention rather than a storage feature. Concentrating the convention here is
 * what keeps it enforceable: {@link ContentSnapshot} is the only caller, every
 * one of its methods routes through exactly one of these builders, and nothing
 * else in the framework composes a storage pathname by hand.
 *
 * Four reserved top-level namespaces divide the tree:
 *
 * - `/pages` — one directory per page, holding its `page.json` metadata, its
 *   bundles, and its template file.
 * - `/templates` — the two site-wide bundles shared by every render.
 * - `/assets` — static files served straight to the browser.
 * - `/emails` — email bundles.
 *
 * Bundle filenames are prefixed with a double underscore so they cannot collide
 * with a published page template, whose filename comes from client input.
 */

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
 * Reserved filename of an email assets bundle within the emails namespace.
 * @type {string}
 * @readonly
 */
export const EMAIL_ASSETS_BUNDLE = '__email-assets';

/**
 * Filenames a page directory reserves for its own bundles. A page template
 * filename must not collide with one of these, because the template shares the
 * directory with them and `batchGetPageAssets()` identifies the template by
 * elimination — any blob in the directory which is not one of these.
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
 *
 * Unlike the other page builders, this takes a full filepath including the
 * filename — `/blog/post/page.html`, not `/blog/post` — because the template is
 * an ordinary file inside the page directory rather than a fixed reserved name.
 * The filename must therefore avoid {@link RESERVED_PAGE_FILENAMES}, and the
 * filepath must name a file rather than the namespace root.
 * @param {string} pathname - Valid logical template filepath, including the filename
 * @returns {string} Canonical pathname beneath `/pages`
 * @throws {AssertionError} When pathname is not a valid pathname
 * @see isValidTemplateFilepath for the non-root filepath rule callers validate against
 */
export function getPageTemplatePath(pathname) {
    assert(isValidPathname(pathname), 'getPageTemplatePath() requires a valid page pathname');
    return getPagesPath(pathname);
}

/**
 * Reports whether a storage pathname names a page's metadata file. Used to sort
 * the results of a bulk page read back into their roles.
 * @param {string} pathname - Canonical storage pathname
 * @returns {boolean} True when the pathname names a `page.json` beneath `/pages`
 */
export function isPageMetadataPath(pathname) {
    return pathname.startsWith('/pages') && pathname.endsWith('/page.json');
}

/**
 * Reports whether a storage pathname names a page's partial-template bundle.
 * @param {string} pathname - Canonical storage pathname
 * @returns {boolean} True when the pathname names a page partials bundle beneath `/pages`
 */
export function isPagePartialsPath(pathname) {
    return pathname.startsWith('/pages') && pathname.endsWith(`/${ PAGE_PARTIALS_BUNDLE }`);
}

/**
 * Reports whether a storage pathname names a page's include bundle.
 * @param {string} pathname - Canonical storage pathname
 * @returns {boolean} True when the pathname names a page includes bundle beneath `/pages`
 */
export function isPageIncludesPath(pathname) {
    return pathname.startsWith('/pages') && pathname.endsWith(`/${ PAGE_INCLUDES_BUNDLE }`);
}

/**
 * Constructs the storage path for an email's assets bundle, within its own
 * directory beneath `/emails`.
 * @param {string} pathname - Valid logical email pathname
 * @returns {string} Canonical pathname beneath `/emails`
 * @throws {AssertionError} When pathname is not a valid pathname
 */
export function getEmailBundlePath(pathname) {
    assert(isValidPathname(pathname), 'getEmailBundlePath() requires a valid email pathname');
    return normalizePathname(`emails/${ pathname }/${ EMAIL_ASSETS_BUNDLE }`);
}
