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
 * Escapes HTML special characters in a string to prevent XSS attacks.
 * Characters escaped: & < > " (the Mustache spec set).
 *
 * @param {*} str - The value to escape. Non-strings are coerced to strings.
 * @returns {string} The escaped string, or empty string if input is null/undefined.
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
