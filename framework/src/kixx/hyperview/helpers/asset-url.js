import { escapeHTMLChars } from '../../templating/mod.js';

/**
 * Renders a fingerprinted asset URL when the asset is published.
 *
 * `assets` is passed explicitly because helpers are bound into cached template
 * render functions, while the asset map belongs to one content snapshot. A
 * missing pathname intentionally falls back to the bare pathname: development
 * serves those source-file URLs without publishing assets into the CAS.
 * @param {Object} _context - Current template frame value; unused
 * @param {Object} _options - Named helper arguments; unused
 * @param {Object<string, string>} assets - Logical pathname-to-hash map
 * @param {string} pathname - Logical asset pathname
 * @returns {string} Escaped fingerprinted URL or the escaped bare pathname
 */
export default function assetUrl(_context, _options, assets, pathname) {
    const hash = assets?.[pathname];
    const url = hash ? `/assets/${ hash }${ pathname }` : pathname;
    return escapeHTMLChars(url);
}
