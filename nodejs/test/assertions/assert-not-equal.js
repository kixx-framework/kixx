import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

const refA = {};

function fnA() {
    return null;
}

const symbolA = Symbol('A');

const bigIntA = BigInt(1);

export const tests = [
    [ 1, 1, 'numbers 1, 1', 'Expected Number(1) to NOT equal (!==) Number(1)', false ],
    [ 1, '1', 'numbers 1, "1"', '', true ],
    [ 0, NaN, 'numbers 0, NaN', '', true ],
    [ 'foo', NaN, 'numbers "foo", NaN', '', true ],
    [ NaN, NaN, 'numbers NaN, NaN', 'Expected Number(NaN) to NOT equal (!==) Number(NaN)', false ],
    [ bigIntA, BigInt(1), 'bigIntA, BigInt(1)', 'Expected BigInt(1) to NOT equal (!==) BigInt(1)', false ],
    [ 1, BigInt(1), '1, BigInt(1)', '', true ],
    [ 'foo', 'foo', 'strings "foo", "foo"', 'Expected String(foo) to NOT equal (!==) String(foo)', false ],
    [ '', '', 'strings "", ""', 'Expected String() to NOT equal (!==) String()', false ],
    [ symbolA, symbolA, 'symbols symbolA, symbolA', 'Expected Symbol(A) to NOT equal (!==) Symbol(A)', false ],
    [ true, true, 'bools true, true', 'Expected Boolean(true) to NOT equal (!==) Boolean(true)', false ],
    [ true, false, 'bools true, false', '', true ],
    [ null, null, 'null, null', 'Expected null to NOT equal (!==) null', false ],
    [ refA, refA, 'references refA, refA', 'Expected Object({}) to NOT equal (!==) Object({})', false ],
    [ fnA, fnA, 'references fnA, fnA', 'Expected Function(fnA) to NOT equal (!==) Function(fnA)', false ],
];

export default function testAssertNotEqual() {
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

            const msg = `assertNotEqual() with ${ label }.`;

            if (expectedToPass) {
                assertions.assertNotEqual(expected, actual, msg);
            } else {
                function testWrapper() {
                    assertions.assertNotEqual(expected, actual, msg);
                }

                assert.throws(testWrapper, {
                    name: 'AssertionError',
                    message: `${ msg } (${ info })`,
                    expected,
                    actual,
                    operator: 'assertNotEqual',
                });
            }
        });
    });
}
