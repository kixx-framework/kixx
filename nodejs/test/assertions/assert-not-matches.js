import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

const symbolA = Symbol('A');

const bigIntA = BigInt(1);

export const tests = [
    // Checks strings with `.includes()`.
    [ true, 'true__', 'cast Boolean to String', 'Expected String(true__) NOT to match Boolean(true)', false ],
    [ 'foo', 'foo', 'strings "foo", "foo"', 'Expected String(foo) NOT to match String(foo)', false ],
    [ 'foo', 'bar', 'strings "foo", "bar"', '', true ],

    // Uses .test() on Regular Expressions.
    [ /^foo/, 'foobar', '/^foo/ test "foobar"', 'Expected String(foobar) NOT to match RegExp(/^foo/)', false ],
    [ /foo$/, 'foobar', '/foo$/ test "foobar"', '', true ],

    [ (1 / 3), (1 / 3), 'numbers (1/3), (1/3)', 'Expected Number(0.3333333333333333) NOT to match Number(0.3333333333333333)', false ],
    [ NaN, NaN, 'numbers NaN, NaN', 'Expected Number(NaN) NOT to match Number(NaN)', false ],
    [ bigIntA, bigIntA, 'bigIntA, bigIntA', 'Expected BigInt(1) NOT to match BigInt(1)', false ],
    [ 1, BigInt(1), '1, BigInt(1)', '', true ],
    [ symbolA, symbolA, 'symbols symbolA, symbolA', 'Expected Symbol(A) NOT to match Symbol(A)', false ],
];

export default function testAssertNotMatches() {
    it('pass/fails with expected values', () => {
        tests.forEach(([ expected, actual, label, info, expectedToPass ], index) => {
            assert.equal(
                typeof label,
                'string',
                `Expect test label to be a string (index ${ index }).`
            );
            assert.equal(
                typeof expectedToPass,
                'boolean',
                `Expect test expectedToPass to be a boolean (index ${ index }).`
            );

            const msg = `assertMatches() with ${ label }.`;

            if (expectedToPass) {
                assertions.assertNotMatches(expected, actual, msg);
            } else {
                function testWrapper() {
                    assertions.assertNotMatches(expected, actual, msg);
                }

                assert.throws(testWrapper, {
                    name: 'AssertionError',
                    message: `${ msg } (${ info })`,
                    expected,
                    actual,
                    operator: 'assertNotMatches',
                });
            }
        });
    });
}
