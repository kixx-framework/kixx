import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { stripJavaScriptComments } from '../../../lib/publishing/strip-asset-comments.js';


describe('publishing/strip-asset-comments', ({ it }) => {
    it('replaces JavaScript comments with lexical whitespace', () => {
        const source = '// first\nconst value = /* middle */ 1;\n/** last */';

        assertEqual(' \nconst value =   1;\n ', stripJavaScriptComments(source));
    });

    it('preserves JavaScript hashbangs, strings, templates, and regular expressions', () => {
        const source = [
            '#!/usr/bin/env node',
            'const string = "// text";',
            'const template = `/* text */`;',
            'const expression = /\\/\\* text \\*\\//;',
            '// removed',
        ].join('\n');

        assertEqual(source.replace('// removed', ' '), stripJavaScriptComments(source));
    });

    it('keeps keywords and identifiers as separate tokens', () => {
        const source = 'globalThis.result = typeof/* separator */missingName;';

        assertEqual(
            'globalThis.result = typeof missingName;',
            stripJavaScriptComments(source),
        );
    });

    it('keeps punctuators as separate tokens', () => {
        const source = 'const result = left +/* separator */+ right;';

        assertEqual(
            'const result = left + + right;',
            stripJavaScriptComments(source),
        );
    });

    it('preserves line terminators which affect semicolon insertion', () => {
        const source = 'function getValue() { return/* first\r\nsecond\u2028third\u2029*/value; }';

        assertEqual(
            'function getValue() { return\r\n\u2028\u2029value; }',
            stripJavaScriptComments(source),
        );
    });

    it('reports JavaScript parse failures with a source location', () => {
        const caught = catchError(() => stripJavaScriptComments('const = 1;'));

        assert(caught, 'expected a syntax error');
        assertEqual('SyntaxError', caught.name);
        assertEqual(1, caught.lineNumber);
        assertEqual(6, caught.column);
    });

});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}
