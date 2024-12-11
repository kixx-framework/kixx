import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

class Cat {}

class ExtendedMap extends Map {}
class ExtendedSet extends Set {}

/* eslint-disable array-bracket-spacing, no-undefined */
export const tests = [
    [ null, 'null', false ],
    [ undefined, 'undefined', false ],
    [ true, 'true', false ],
    [ false, 'false', false ],
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
    [ Cat, 'class Cat', false ],
    [ function () {}, 'anonymous function declaration', false ],
    [ {}, 'empty Object {}', false ],
    [ new Date(), 'new Date()', false ],
    [ new Date('invalid'), 'new Date("invalid")', false ],
    [ [], 'empty Array []', false ],
    [ new Map(), 'new Map()', true ],
    [ new Set(), 'new Set()', false ],
    [ new WeakMap(), 'new WeakMap()', true ],
    [ new WeakSet(), 'new WeakSet()', false ],
    [ new ExtendedMap(), 'new ExtendedMap()', true ],
    [ new ExtendedSet(), 'new ExtendedSet()', false ],
    [ new RegExp('^start', 'i'), 'new RegExp("^start", "i")', false ],
];
/* eslint-enable array-bracket-spacing, no-undefined */

export default function testIsMap() {
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

            const msg = `isMap() with ${ label } (index ${ index }).`;

            assert.equal(assertions.isMap(val), expectedResult, msg);
        });
    });
}
