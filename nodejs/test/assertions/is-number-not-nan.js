import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

/* eslint-disable array-bracket-spacing */
export const tests = [
    [ null, 'null', false ],
    [ undefined, 'undefined', false ],
    [ true, 'true', false ],
    [ false, 'false', false ],
    [ 0, '0', true ],
    [ 1, '1', true ],
    [ NaN, 'NaN', false ],
    [ '1', '"1"', false ],
    [ '', 'empty String', false ],
    [ 'foo', '"foo"', false],
    [ String(''), 'String("")', false ],
    [ String('foo'), 'String("foo")', false ],
    [ {}, 'emty Object {}', false ],
    [ [], 'empty Array []', false ],
    [ new Map(), 'new Map()', false ],
    [ new Set(), 'new Set()', false ],
];
/* eslint-enable array-bracket-spacing */

export default function testIsNumberNotNaN() {
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

            const msg = `isNumberNotNaN() with ${ label } (index ${ index }).`;

            assert.equal(assertions.isNumberNotNaN(val), expectedResult, msg);
        });
    });
}
