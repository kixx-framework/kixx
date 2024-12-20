import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertArray, toFriendlyString } from '../../assertions/mod.js';

class Cat {}

const arrowFunc = () => {
    return null;
};

function funcDef() {
    return null;
}

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
    [ new Cat(), 'new Cat', false ],
    [ Cat.constructor, 'Cat constructor', false ],
    [ arrowFunc, 'anonymous arrow function', false ],
    [ funcDef, 'anonymous function', false ],
    [ {}, 'emty Object {}', false ],
    [ Object.create(null), 'Object.create(null)', false ],
    [ Object.create({}), 'Object.create({})', false ],
    [ Object.create(new Cat()), 'Object.create(new Cat())', false ],
    [ new Object(), 'new Object()', false ],
    [ new Date(), 'new Date()', false ],
    [ new Date('invalid'), 'new Date("invalid")', false ],
    [ [], 'empty Array []', true ],
    [ [ 1, 2 ], 'Array [1,2]', true ],
    [ new Map(), 'new Map()', false ],
    [ new Set(), 'new Set()', false ],
    [ new RegExp('^start', 'i'), 'new RegExp("^start", "i")', false ],
];
/* eslint-enable array-bracket-spacing, no-undefined */

export default function testAssertArray() {
    it('pass/fails with expected values', () => {
        tests.forEach(([ val, label, shouldPass ], index) => {
            assert.equal(
                typeof label,
                'string',
                `Expect test label to be a string (index ${ index }).`
            );
            assert.equal(
                typeof shouldPass,
                'boolean',
                `Expect test shouldPass to be a boolean (index ${ index }).`
            );

            const msg = `assertArray() with ${ label } (index ${ index }).`;

            if (shouldPass) {
                assertArray(val, msg);
            } else {
                try {
                    // With the optional message prefix.
                    assertArray(val, msg);
                    throw new Error('This should have thrown');
                } catch (error) {
                    assert.equal(error.name, 'AssertionError');
                    assert.equal(error.message, `${ msg } (Expected ${ toFriendlyString(val) } to be an Array)`);
                    assert.equal(error.operator, 'assertArray');
                }
                try {
                    // Without the optional message prefix.
                    assertArray(val);
                    throw new Error('This should have thrown');
                } catch (error) {
                    assert.equal(error.name, 'AssertionError');
                    assert.equal(error.message, `Expected ${ toFriendlyString(val) } to be an Array`);
                    assert.equal(error.operator, 'assertArray');
                }
            }
        });
    });
}
