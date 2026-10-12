// The Mustache spec escapes exactly these four characters. Callers needing a
// stricter policy (e.g. also escaping ' ` =) can pass a custom `escape` function
// to createRenderFunction.
const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
};

const DISALLOWED_CHARS = /[&<>"]/g;
const REPLACE_CHARS = /[&<>"]/;

function escapeChar(chr) {
    return ESCAPE_MAP[chr];
}

/**
 * Escapes the Mustache HTML character set: &, <, >, and ".
 *
 * @param {*} str - Value to escape; non-string values are coerced to strings.
 * @returns {string} Escaped text, or an empty string for null and undefined.
 */
export function escapeHTMLChars(str) {
    if (typeof str === 'undefined' || str === null) {
        return '';
    } else if (!str || typeof str !== 'string') {
        // eslint-disable-next-line no-implicit-coercion
        return str + '';
    }

    if (REPLACE_CHARS.test(str)) {
        return str.replace(DISALLOWED_CHARS, escapeChar);
    }
    return str;
}
