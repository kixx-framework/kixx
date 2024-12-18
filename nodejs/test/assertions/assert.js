import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';


const tests = [
    [ null, 'null', 'Expected null to be truthy', false ],
    // eslint-disable-next-line no-undefined
    [ undefined, 'undefined', 'Expected undefined to be truthy', false ],
    [ true, 'true', '', true ],
    [ false, 'false', 'Expected Boolean(false) to be truthy', false ],
    [ -1, '-1', '', true ],
    [ 0, '0', 'Expected Number(0) to be truthy', false ],
    [ 1, '1', '', true ],
    [ 0.1, '0.1', '', true ],
    [ NaN, 'NaN', 'Expected Number(NaN) to be truthy', false ],
    [ BigInt(-1), 'BigInt(-1)', '', true ],
    [ BigInt(0), 'BigInt(0)', 'Expected BigInt(0) to be truthy', false ],
    [ BigInt(1), 'BigInt(1)', '', true ],
    [ '1', '"1"', '', true ],
    [ '0.1', '"0.1"', '', true ],
    [ '7n', '"7n"', '', true ],
    [ '', 'empty String', 'Expected String() to be truthy', false ],
    [ 'foo', '"foo"', '', true ],
    [ Symbol(), 'Symbol()', '', true ],
    [ Symbol('foo'), 'Symbol("foo")', '', true ],
    // eslint-disable-next-line brace-style
    [ () => { return null; }, 'anonymous arrow function', '', true ],
    [{}, 'empty Object {}', '', true ],
];

export default function testAssert() {
    it('pass/fails with expected values', () => {
        tests.forEach(([ val, label, info, expectedToPass ], index) => {
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

            const msg = `assert() with ${ label }.`;

            if (expectedToPass) {
                assertions.assert(val, msg);
            } else {
                function testWrapper() {
                    assertions.assert(val, msg);
                }

                assert.throws(testWrapper, {
                    name: 'AssertionError',
                    message: `${ msg } (${ info })`,
                    expected: true,
                    actual: val,
                    operator: 'assert',
                });
            }
        });
    });
}
