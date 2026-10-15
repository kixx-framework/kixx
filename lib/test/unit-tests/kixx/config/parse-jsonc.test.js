import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { parseJsonc } from '../../../../kixx/config/parse-jsonc.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('parseJsonc', ({ it }) => {

    it('parses plain JSON', () => {
        const value = parseJsonc('{"a": 1, "b": [true, null, "x"], "c": {"d": -1.5e3}}');

        assertEqual(1, value.a);
        assertEqual(3, value.b.length);
        assertEqual(null, value.b[1]);
        assertEqual(-1500, value.c.d);
    });

    it('ignores line and block comments', () => {
        const value = parseJsonc([
            '// leading comment',
            '{',
            '    /* block',
            '       comment */',
            '    "a": 1, // trailing comment',
            '    // "b": 2,',
            '    "c": /* inline */ 3',
            '}',
        ].join('\n'));

        assertEqual(1, value.a);
        assert(!Object.hasOwn(value, 'b'), 'commented-out key must not be parsed');
        assertEqual(3, value.c);
    });

    it('ignores trailing commas in objects and arrays', () => {
        const value = parseJsonc('{"a": [1, 2, ], "b": {"c": 3, /* x */ }, }');

        assertEqual(2, value.a.length);
        assertEqual(3, value.b.c);
    });

    it('leaves comment and comma characters inside strings alone', () => {
        const value = parseJsonc('{"url": "https://example.com/*x*/", "list": "a,]", "quote": "say \\"//hi\\""}');

        assertEqual('https://example.com/*x*/', value.url);
        assertEqual('a,]', value.list);
        assertEqual('say "//hi"', value.quote);
    });

    it('handles CRLF line endings', () => {
        const value = parseJsonc('{\r\n    "a": 1, // comment\r\n    "b": 2,\r\n}');

        assertEqual(1, value.a);
        assertEqual(2, value.b);
    });

    it('rejects a comma with no value between it and the previous one', () => {
        const error = catchError(() => parseJsonc('[1,,]'));

        assert(error, 'expected an error');
        assertEqual('OperationalError', error.name);
    });

    it('rejects an unterminated block comment', () => {
        const error = catchError(() => parseJsonc('{"a": 1 /* never closed'));

        assert(error, 'expected an error');
        assertMatches('unterminated block comment', error.message);
    });

    it('rejects JSON5 syntax', () => {
        assert(catchError(() => parseJsonc('{a: 1}')), 'expected unquoted key to fail');
        assert(catchError(() => parseJsonc("{\"a\": 'x'}")), 'expected single quotes to fail');
    });

    it('rejects non-string input', () => {
        const error = catchError(() => parseJsonc(null));

        assert(error, 'expected an error');
        assertMatches('requires a string', error.message);
    });
});
