import { isString } from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';


/**
 * Parses JSONC text: JSON plus `//` line comments, `/* *\/` block comments,
 * and trailing commas before a closing `}` or `]`. This is the dialect of
 * VS Code settings files and `wrangler.jsonc`, and nothing more: no unquoted
 * keys, single-quoted strings, or other JSON5 syntax.
 *
 * Comments and trailing commas are blanked out with spaces (newlines inside
 * block comments are kept) before handing the text to JSON.parse, so any
 * position JSON.parse reports in an error message is also the position in
 * the original source.
 *
 * @param {string} source - JSONC text
 * @returns {*} The parsed value
 * @throws {OperationalError} When the source is not a string, has an unterminated block comment, or is not valid JSON once comments and trailing commas are removed
 */
export function parseJsonc(source) {
    if (!isString(source)) {
        throw new OperationalError('parseJsonc requires a string', {}, parseJsonc);
    }

    const json = stripJsoncSyntax(source);

    try {
        return JSON.parse(json);
    } catch (cause) {
        throw new OperationalError(`Invalid JSONC: ${ cause.message }`, { cause }, parseJsonc);
    }
}

function stripJsoncSyntax(source) {
    const chars = source.split('');
    // Index of the last comma seen outside a string, kept until a value
    // follows it. If a closing bracket comes first, the comma is trailing.
    let pendingCommaIndex = -1;
    let i = 0;

    while (i < chars.length) {
        const char = chars[i];

        if (char === '"') {
            pendingCommaIndex = -1;
            i = skipString(chars, i);
        } else if (char === '/' && chars[i + 1] === '/') {
            while (i < chars.length && chars[i] !== '\n' && chars[i] !== '\r') {
                chars[i] = ' ';
                i += 1;
            }
        } else if (char === '/' && chars[i + 1] === '*') {
            const start = i;
            i += 2;
            while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
                i += 1;
            }
            if (i >= chars.length) {
                throw new OperationalError(
                    `Invalid JSONC: unterminated block comment at position ${ start }`,
                    {},
                    parseJsonc,
                );
            }
            i += 2;
            for (let j = start; j < i; j += 1) {
                if (chars[j] !== '\n' && chars[j] !== '\r') {
                    chars[j] = ' ';
                }
            }
        } else if (char === ',') {
            pendingCommaIndex = i;
            i += 1;
        } else if (char === '}' || char === ']') {
            if (pendingCommaIndex !== -1) {
                chars[pendingCommaIndex] = ' ';
                pendingCommaIndex = -1;
            }
            i += 1;
        } else {
            if (!isWhitespace(char)) {
                pendingCommaIndex = -1;
            }
            i += 1;
        }
    }

    return chars.join('');
}

// Returns the index just past the closing quote. An unterminated string is
// left for JSON.parse to report.
function skipString(chars, openingQuoteIndex) {
    let i = openingQuoteIndex + 1;
    while (i < chars.length) {
        if (chars[i] === '\\') {
            i += 2;
        } else if (chars[i] === '"') {
            return i + 1;
        } else {
            i += 1;
        }
    }
    return i;
}

function isWhitespace(char) {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
