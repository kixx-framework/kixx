import { isString } from './vendor/kixx-assert/mod.js';


/**
 * Parses JSONC text: JSON plus `//` line comments, `/* *\/` block comments,
 * and trailing commas before a closing `}` or `]`. Nothing more: no unquoted
 * keys, single-quoted strings, or other JSON5 syntax.
 *
 * Ported from the Kixx library's `kixx/config/parse-jsonc.js` so the CLI
 * accepts exactly the dialect the application reads.
 *
 * Comments and trailing commas are blanked out with spaces (newlines inside
 * block comments are kept) before handing the text to JSON.parse, so any
 * position JSON.parse reports is also the position in the original source.
 *
 * @param {string} source - JSONC text
 * @returns {*} The parsed value
 * @throws {TypeError} When the source is not a string
 * @throws {SyntaxError} When the source has an unterminated block comment, or is not valid JSON once comments and trailing commas are removed
 */
export function parseJsonc(source) {
    if (!isString(source)) {
        throw new TypeError('parseJsonc requires a string');
    }

    const json = stripJsoncSyntax(source);

    try {
        return JSON.parse(json);
    } catch (cause) {
        throw new SyntaxError(`Invalid JSONC: ${ cause.message }`, { cause });
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
                throw new SyntaxError(`Invalid JSONC: unterminated block comment at position ${ start }`);
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
