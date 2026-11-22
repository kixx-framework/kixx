import { parse } from './vendor/acorn/src/index.js';


/**
 * Parses JavaScript source with the vendored acorn parser.
 *
 * Acorn reports a syntax error's line and column on `loc`. When the error
 * has no numeric `lineNumber`, it also gets `lineNumber` (1-based) and
 * `column` (0-based), copied from `loc.line` and `loc.column`, so callers
 * read the position the same way they do for other errors. The thrown
 * object is acorn's own error.
 *
 * @param {string} sourceText - JavaScript source
 * @param {Object} options - Acorn parse options, passed through unchanged
 * @returns {Object} The acorn `Program` AST
 * @throws {SyntaxError} When the source is not valid JavaScript for the given options
 */
export function parseJavaScript(sourceText, options) {
    try {
        return parse(sourceText, options);
    } catch (error) {
        addLineNumber(error);
        throw error;
    }
}

function addLineNumber(error) {
    const isLocatedSyntaxError = error
        && error.name === 'SyntaxError'
        && error.loc
        && typeof error.loc.line === 'number'
        && typeof error.loc.column === 'number';

    if (isLocatedSyntaxError && typeof error.lineNumber !== 'number') {
        error.lineNumber = error.loc.line;
        error.column = error.loc.column;
    }
}
