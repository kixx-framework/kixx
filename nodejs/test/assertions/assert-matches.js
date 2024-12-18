import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

const symbolA = Symbol('A');
const symbolB = Symbol('B');

const bigIntA = BigInt(1);
const bigIntB = BigInt(2);

export const tests = [
    // Checks strings with `.includes()`.
    [ true, 'true__', 'cast Boolean to String', '', true ],
    [ '', '', 'strings "", ""', '', true ],
    [ '', ' ', 'strings "", " "', '', true ],
    [ 1, '1', 'numbers 1, "1"', '', true ],
    [ 'foo', 'foo', 'strings "foo", "foo"', '', true ],
    [ 'foo', 'bar', 'strings "foo", "bar"', 'Expected String(bar) to match String(foo)', false ],

    // Uses .test() on Regular Expressions.
    [ /^foo/, 'foobar', '/^foo/ test "foobar"', '', true ],
    [ /foo$/, 'foobar', '/foo$/ test "foobar"', 'Expected String(foobar) to match RegExp(/foo$/)', false ],

    [ (1 / 3), (1 / 3), 'numbers (1/3), (1/3)', '', true ],
    [ NaN, NaN, 'numbers NaN, NaN', '', true ],
    [ bigIntA, bigIntA, 'bigIntA, bigIntA', '', true ],
    [ 1, BigInt(1), '1, BigInt(1)', 'Expected BigInt(1) to match Number(1)', false ],
    [ bigIntA, bigIntB, 'bigIntA, bigIntB', 'Expected BigInt(2) to match BigInt(1)', false ],
    [ symbolA, symbolA, 'symbols symbolA, symbolA', '', true ],
    [ symbolA, symbolB, 'symbols symbolA, symbolB', 'Expected Symbol(B) to match Symbol(A)', false ],
    [ symbolA, Symbol('A'), 'symbols symbolA, Symbol("A")', 'Expected Symbol(A) to match Symbol(A)', false ],
];

export default function testAssertMatches() {
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
                assertions.assertMatches(expected, actual, msg);
            } else {
                function testWrapper() {
                    assertions.assertMatches(expected, actual, msg);
                }

                assert.throws(testWrapper, {
                    name: 'AssertionError',
                    message: `${ msg } (${ info })`,
                    expected,
                    actual,
                    operator: 'assertMatches',
                });
            }
        });
    });
}
