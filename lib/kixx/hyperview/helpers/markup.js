import { marked } from '../../vendor/marked/mod.js';
import { toFriendlyString } from '../../assertions/mod.js';


/**
 * Template helper which renders Markdown source as HTML.
 *
 * Helper return values are written to the output without escaping, so this is
 * the intended way to emit rendered Markdown; it also means the source must be
 * trusted, authored content and never unescaped user input.
 *
 * An absent or empty value renders nothing, matching `formatDate` and
 * `truncate`, so an optional page field left unpublished is an omission rather
 * than the literal text `null`.
 *
 * Any other non-string value is not an error: it is formatted for diagnostics
 * and rendered in place, so a page with a mistyped field still renders and
 * shows what it received.
 * @param {Object} _context - Current template frame value; unused
 * @param {Object} _options - Named helper arguments; unused
 * @param {string} markdown - Markdown source to render
 * @returns {string} Rendered HTML, an empty string for a falsy value, or a diagnostic string for a non-string value
 * @see markup Helper in ../../../templates/README.md for template usage
 */
export default function markup(_context, _options, markdown) {
    if (!markdown) {
        return '';
    }

    if (typeof markdown === 'string') {
        return marked.parse(markdown);
    }

    return toFriendlyString(markdown);
}
