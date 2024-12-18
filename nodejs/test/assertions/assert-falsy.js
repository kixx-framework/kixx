import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';


const tests = [
    [ null, 'null', 'Expected null to be truthy', true ],
    // eslint-disable-next-line no-undefined
    [ undefined, 'undefined', 'Expected undefined to be truthy', true ],
    [ true, 'true', 'Expected Boolean(true) to be falsy', false ],
    [ false, 'false', 'Expected Boolean(false) to be truthy', true ],
    [ -1, '-1', 'Expected Number(-1) to be falsy', false ],
    [ 0, '0', 'Expected Number(0) to be truthy', true ],
    [ 1, '1', 'Expected Number(1) to be falsy', false ],
    [ 0.1, '0.1', 'Expected Number(0.1) to be falsy', false ],
    [ NaN, 'NaN', 'Expected Number(NaN) to be truthy', true ],
    [ BigInt(-1), 'BigInt(-1)', 'Expected BigInt(-1) to be falsy', false ],
    [ BigInt(0), 'BigInt(0)', 'Expected BigInt(0) to be truthy', true ],
    [ BigInt(1), 'BigInt(1)', 'Expected BigInt(1) to be falsy', false ],
    [ '1', '"1"', 'Expected String(1) to be falsy', false ],
    [ '0.1', '"0.1"', 'Expected String(0.1) to be falsy', false ],
    [ '7n', '"7n"', 'Expected String(7n) to be falsy', false ],
    [ '', 'empty String', 'Expected String() to be truthy', true ],
    [ 'foo', '"foo"', 'Expected String(foo) to be falsy', false ],
    [ Symbol(), 'Symbol()', 'Expected Symbol() to be falsy', false ],
    [ Symbol('foo'), 'Symbol("foo")', 'Expected Symbol(foo) to be falsy', false ],
    // eslint-disable-next-line brace-style
    [ () => { return null; }, 'anonymous arrow function', 'Expected Function(function) to be falsy', false ],
    [{}, 'empty Object {}', 'Expected Object({}) to be falsy', false ],
];


export default function testAssertFalsy() {
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

            const msg = `assertFalsy() with ${ label }.`;

            if (expectedToPass) {
                assertions.assertFalsy(val, msg);
            } else {
                function testWrapper() {
                    assertions.assertFalsy(val, msg);
                }

                assert.throws(testWrapper, {
                    name: 'AssertionError',
                    message: `${ msg } (${ info })`,
                    expected: false,
                    actual: val,
                    operator: 'assertFalsy',
                });
            }
        });
    });
}
