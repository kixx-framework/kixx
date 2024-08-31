import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

/* eslint-disable array-bracket-spacing, no-undefined */
export const tests = [
    [ null, 'null', false ],
    [ undefined, 'undefined', false ],
    [ true, 'true', false ],
    [ false, 'false', false ],
    [ 0, '0', false ],
    [ 1, '1', false ],
    [ NaN, 'NaN', false ],
    [ '1', '"1"', true ],
    [ '', 'empty String', false ],
    [ 'foo', '"foo"', true],
    [ String(''), 'String("")', false ],
    [ String('foo'), 'String("foo")', true ],
    [ {}, 'emty Object {}', false],
    [ [], 'empty Array []', false],
    [ new Map(), 'new Map()', false],
    [ new Set(), 'new Set()', false],
];
/* eslint-enable array-bracket-spacing, no-undefined */

export default function testIsNonEmptyString() {
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

            const msg = `isNonEmptyString() with ${ label } (index ${ index }).`;

            assert.equal(assertions.isNonEmptyString(val), expectedResult, msg);
        });
    });
}
