import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { parse } from '../../../lib/vendor/acorn/index.js';
import stripComments from '../../../lib/bundler/strip-comments.js';

describe('stripComments', ({ it }) => {
    it('removes line, block, and JSDoc comments while preserving lines', () => {
        const source = [
            '// line comment',
            '/** JSDoc comment */',
            'export const first = 1; /* inline block */',
            '/* block comment',
            '   over two lines */',
            'export const second = 2;',
        ].join('\n');
        const result = stripComments(source);

        assertEqual(source.split('\n').length, result.source.split('\n').length);
        assertEqual(6, getLine(result.source, 'export const second = 2;'));
        assertEqual(false, result.source.includes('comment'));
        assertEqual('Program', result.ast.type);
    });

    it('leaves comment-like text in literals untouched', () => {
        const source = [
            'const string = "// not a comment";',
            'const template = `/* not a comment */`;',
            'const regularExpression = /\\/\\* not a comment \\*\\//;',
        ].join('\n');
        const result = stripComments(source);

        assertEqual(source, result.source);
    });

    it('preserves a leading hashbang', () => {
        const source = '#!/usr/bin/env node\n// comment\nexport default 1;';
        const result = stripComments(source);

        assertEqual('#!/usr/bin/env node\n\nexport default 1;', result.source);
    });

    it('returns uncommented source unchanged', () => {
        const source = 'export const value = 1;';

        assertEqual(source, stripComments(source).source);
    });

    it('returns source that still parses', () => {
        const source = 'export const value = /* comment */ 1;';
        const result = stripComments(source);
        const ast = parse(result.source, {
            ecmaVersion: 'latest',
            sourceType: 'module',
        });

        assertEqual('Program', ast.type);
    });

    it('propagates Acorn syntax errors with a location', () => {
        const caught = catchError(() => stripComments('export const = 1;'));

        assert(caught, 'expected a syntax error');
        assertEqual('SyntaxError', caught.name);
        assertEqual(true, typeof caught.lineNumber === 'number');
        assertEqual(true, typeof caught.column === 'number');
    });
});

function getLine(source, statement) {
    return source.split('\n').findIndex(line => line.includes(statement)) + 1;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}
