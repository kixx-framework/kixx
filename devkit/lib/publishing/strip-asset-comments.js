import { parse } from '../vendor/acorn/index.js';

/**
 * Removes JavaScript comments while preserving syntax-bearing comment-like text.
 * @param {string} source - JavaScript source
 * @returns {string} Source with comments replaced by lexical whitespace
 * @throws {SyntaxError} When source is not valid JavaScript
 */
export function stripJavaScriptComments(source) {
    const comments = [];

    parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
        onComment: comments,
    });

    const retainedComments = comments.filter((comment) => {
        return !source.slice(comment.start, comment.end).startsWith('#!');
    });
    const stripped = replaceJavaScriptCommentRanges(source, retainedComments);

    parse(stripped, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
    });

    return stripped;
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
