import { toFriendlyString } from '../../assertions/mod.js';


/**
 * Template helper which shortens a string to a maximum character count.
 *
 * The default ellipsis is the `&hellip;` entity rather than a literal character,
 * because helper output is written to the page without escaping.
 *
 * The count is measured in JavaScript characters, so a string containing
 * astral-plane characters can be cut mid-pair. That is acceptable for the
 * summary text this helper exists for, and is the reason it is not used for
 * anything a byte- or grapheme-accurate limit depends on.
 * @param {Object} _context - Current template frame value; unused
 * @param {Object} _options - Named helper arguments; unused
 * @param {string} str - String to shorten
 * @param {number} length - Maximum number of characters to keep
 * @param {string} [ellipsis='&hellip;'] - Suffix appended when the string is shortened; pass an empty string to append nothing
 * @returns {string} The original string when it is already short enough, the shortened string otherwise, an empty string for a falsy value, or a diagnostic string for a non-string value
 * @see truncate Helper in ../../../templates/README.md for template usage
 */
export default function truncate(_context, _options, str, length, ellipsis) {
    if (!str) {
        return '';
    }

    if (typeof str === 'string') {
        if (str.length <= length) {
            return str;
        }

        if (typeof ellipsis === 'undefined') {
            ellipsis = '&hellip;';
        }

        if (ellipsis) {
            return str.slice(0, length) + ellipsis;
        }

        return str.slice(0, length);
    }

    return toFriendlyString(str);
}
