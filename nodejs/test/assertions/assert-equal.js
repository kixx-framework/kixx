import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

const refA = {};

function fnA() {
    return null;
}
function fnB() {
    return null;
}

const symbolA = Symbol('A');
const symbolB = Symbol('B');

const bigIntA = BigInt(1);
const bigIntB = BigInt(2);

export const tests = [
    [ 1, 1, 'numbers 1, 1', '', true ],
    [ 2, 1, 'numbers 2, 1', 'Expected Number(1) to equal (===) Number(2)', false ],
    [ 1, '1', 'numbers 1, "1"', 'Expected String(1) to equal (===) Number(1)', false ],
    [ NaN, -0, 'numbers NaN, -0', 'Expected Number(0) to equal (===) Number(NaN)', false ],
    [ 0, NaN, 'numbers 0, NaN', 'Expected Number(NaN) to equal (===) Number(0)', false ],
    [ 'foo', NaN, 'numbers "foo", NaN', 'Expected Number(NaN) to equal (===) String(foo)', false ],
    [ NaN, NaN, 'numbers NaN, NaN', '', true ],
    [ bigIntA, BigInt(1), 'bigIntA, BigInt(1)', '', true ],
    [ 1, BigInt(1), '1, BigInt(1)', 'Expected BigInt(1) to equal (===) Number(1)', false ],
    [ bigIntA, bigIntB, 'bigIntA, bigIntB', 'Expected BigInt(2) to equal (===) BigInt(1)', false ],
    [ 'foo', 'foo', 'strings "foo", "foo"', '', true ],
    [ '', '', 'strings "", ""', '', true ],
    [ '', ' ', 'strings "", " "', 'Expected String( ) to equal (===) String()', false ],
    [ '1', 1, 'strings "1", 1', 'Expected Number(1) to equal (===) String(1)', false ],
    [ '1', BigInt(1), 'strings "1", BigInt(1)', 'Expected BigInt(1) to equal (===) String(1)', false ],
    [ 'a', Symbol('a'), 'strings "a", Symbol("a")', 'Expected Symbol(a) to equal (===) String(a)', false ],
    [ symbolA, symbolA, 'symbols symbolA, symbolA', '', true ],
    [ symbolA, symbolB, 'symbols symbolA, symbolB', 'Expected Symbol(B) to equal (===) Symbol(A)', false ],
    [ symbolA, Symbol('A'), 'symbols symbolA, Symbol("A")', 'Expected Symbol(A) to equal (===) Symbol(A)', false ],
    [ true, true, 'bools true, true', '', true ],
    [ false, false, 'bools false, false', '', true ],
    [ true, false, 'bools true, false', 'Expected Boolean(false) to equal (===) Boolean(true)', false ],
    [ false, null, 'bools false, null', 'Expected null to equal (===) Boolean(false)', false ],
    [ false, 0, 'bools false, 0', 'Expected Number(0) to equal (===) Boolean(false)', false ],
    [ false, '', 'bools false, ""', 'Expected String() to equal (===) Boolean(false)', false ],
    [ true, 1, 'bools true, 1', 'Expected Number(1) to equal (===) Boolean(true)', false ],
    [ true, 'x', 'bools true, "x"', 'Expected String(x) to equal (===) Boolean(true)', false ],
    [ null, null, 'null, null', '', true ],
    [ null, false, 'null, false', 'Expected Boolean(false) to equal (===) null', false ],
    [ null, 0, 'null, 0', 'Expected Number(0) to equal (===) null', false ],
    [ null, NaN, 'null, NaN', 'Expected Number(NaN) to equal (===) null', false ],
    [ null, Object.create(null), 'null, Object.create(null)', 'Expected Object(null) to equal (===) null', false ],
    [ refA, {}, 'references refA, {}', 'Expected Object({}) to equal (===) Object({})', false ],
    [ refA, refA, 'references refA, refA', '', true ],
    [ fnA, fnB, 'references fnA, fnB', 'Expected Function(fnB) to equal (===) Function(fnA)', false ],
    [ fnA, fnA, 'references fnA, fnA', '', true ],
];

export default function testAssertEqual() {
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

            const msg = `assertEqual() with ${ label }.`;

            if (expectedToPass) {
                assertions.assertEqual(expected, actual, msg);
            } else {
                function testWrapper() {
                    assertions.assertEqual(expected, actual, msg);
                }

                assert.throws(testWrapper, {
                    name: 'AssertionError',
                    message: `${ msg } (${ info })`,
                    expected,
                    actual,
                    operator: 'assertEqual',
                });
            }
        });
    });
}
