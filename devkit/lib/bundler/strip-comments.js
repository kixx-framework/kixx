import { parse } from '../vendor/acorn/index.js';

/**
 * Parses an ES module and removes its comments without changing line numbers.
 * @param {string} source - Module source text.
 * @returns {{ ast: Object, source: string }} Parsed AST and comment-stripped source.
 * @throws {SyntaxError} When source is not valid ES module syntax.
 */
export default function stripComments(source) {
    const comments = [];
    const ast = parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ranges: true,
        locations: true,
        onComment: comments,
    });
    // This vendored Acorn release reports a leading hashbang as a line comment,
    // although the bundled module must retain it as the first line.
    const orderedComments = comments
        .filter(comment => !source.slice(comment.start, comment.end).startsWith('#!'))
        .sort((left, right) => left.start - right.start);
    let position = 0;
    let strippedSource = '';

    for (const comment of orderedComments) {
        strippedSource += source.slice(position, comment.start);
        strippedSource += source.slice(comment.start, comment.end).replaceAll(/[^\n]/g, '');
        position = comment.end;
    }

    strippedSource += source.slice(position);

    return {
        ast,
        source: strippedSource,
    };
}
