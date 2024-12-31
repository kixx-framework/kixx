import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

/* eslint-disable brace-style, array-bracket-spacing */
export const tests = [
    [ null, 'null', false ],
    [ undefined, 'undefined', false ],
    [ true, 'true', true ],
    [ false, 'false', true ],
    [ -1, '-1', false ],
    [ 0, '0', false ],
    [ 1, '1', false ],
    [ 0.1, '0.1', false ],
    [ NaN, 'NaN', false ],
    [ BigInt(-1), 'BigInt(-1)', false ],
    [ BigInt(0), 'BigInt(0)', false ],
    [ BigInt(1), 'BigInt(1)', false ],
    [ '1', '"1"', false ],
    [ '0.1', '"0.1"', false ],
    [ '7n', '"7n"', false ],
    [ '', 'empty String', false ],
    [ 'foo', '"foo"', false ],
    [ String(''), 'String("")', false ],
    [ String('foo'), 'String("foo")', false ],
    [ Symbol(), 'Symbol()', false ],
    [ Symbol('foo'), 'Symbol("foo")', false ],
    [ () => { return null; }, 'anonymous arrow function', false ],
    [ function () { return null; }, 'anonymous function', false ],
    [ {}, 'emty Object {}', false],
    [ new Date(), 'new Date()', false],
    [ new Date('invalid'), 'new Date("invalid")', false ],
    [ [], 'empty Array []', false],
    [ new Map(), 'new Map()', false],
    [ new Set(), 'new Set()', false],
    [ new RegExp('^start', 'i'), 'new RegExp("^start", "i")', false ],
];
/* eslint-enable brace-style, array-bracket-spacing */

export default function testIsBoolean() {
    it('pass/fails with expected values', () => {
        tests.forEach(([ val, label, expectedResult ], index) => {
            assert.equal(
                typeof label,
                'string',
                `Expect test label to be a string (index ${ index }).`
            );
            assert.equal(
                typeof expectedResult,
                'boolean',
                `Expect test expectedResult to be a boolean (index ${ index }).`
            );

            const msg = `isBoolean() with ${ label } (index ${ index }).`;

            assert.equal(assertions.isBoolean(val), expectedResult, msg);
        });
    });
}
