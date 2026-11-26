import { parse } from '../vendor/acorn/mod.js';


/**
 * Removes JavaScript comments while preserving syntax-bearing comment-like text.
 * @param {string} source - JavaScript source
 * @returns {string} Source with comments replaced by lexical whitespace
 * @throws {SyntaxError} When source is not valid JavaScript; carries `lineNumber` and `column`
 */
export function stripJavaScriptComments(source) {
    const comments = [];

    parseJavaScript(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
        onComment: comments,
    });

    const retainedComments = comments.filter((comment) => {
        return !source.slice(comment.start, comment.end).startsWith('#!');
    });
    const stripped = replaceJavaScriptCommentRanges(source, retainedComments);

    parseJavaScript(stripped, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
    });

    return stripped;
}

// Acorn reports a syntax error's position on `loc`. Callers read
// `lineNumber` (1-based) and `column` (0-based), so copy them over.
function parseJavaScript(source, options) {
    try {
        return parse(source, options);
    } catch (error) {
        if (error?.loc && typeof error.lineNumber !== 'number') {
            error.lineNumber = error.loc.line;
            error.column = error.loc.column;
        }

        throw error;
    }
}

function replaceJavaScriptCommentRanges(source, ranges) {
    let output = '';
    let position = 0;

    for (const range of ranges) {
        output += source.slice(position, range.start);
        output += getJavaScriptCommentReplacement(
            source.slice(range.start, range.end),
        );
        position = range.end;
    }

    return output + source.slice(position);
}

function getJavaScriptCommentReplacement(comment) {
    const lineTerminators = comment.match(/[\r\n\u2028\u2029]/g);
    return lineTerminators ? lineTerminators.join('') : ' ';
}
