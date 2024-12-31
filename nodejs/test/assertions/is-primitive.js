import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';


class Cat {}

class Dog {
    constructor() {
        this.foo = 1;
        this.notta = null;

        Object.defineProperty(this, 'hidden', {
            enumerable: false,
            value: 3,
        });
    }

    get bar() {
        return 2;
    }
}

const arrowFunc = () => {
    return null;
};

function funcDef() {
    return null;
}

/* eslint-disable brace-style, array-bracket-spacing */
const tests = [
    [ null, 'null', true ],
    [ undefined, 'undefined', true ],
    [ true, 'true', true ],
    [ false, 'false', true ],
    [ Boolean(1), 'Boolean(1)', true ],
    [ Boolean(0), 'Boolean(0)', true ],
    [ -1, '-1', true ],
    [ 0, '0', true ],
    [ 1, '1', true ],
    [ 0.1, '0.1', true ],
    [ Number(-1), 'Number(-1)', true ],
    [ Number(0), 'Number(0)', true ],
    [ Number(1), 'Number(1)', true ],
    [ Number(0.1), 'Number(0.1)', true ],
    [ NaN, 'NaN', true ],
    [ BigInt(-1), 'BigInt(-1)', true ],
    [ BigInt(0), 'BigInt(0)', true ],
    [ BigInt(1), 'BigInt(1)', true ],
    [ '1', '"1"', true ],
    [ '0.1', '"0.1"', true ],
    [ '7n', '"7n"', true ],
    [ '', 'empty String', true ],
    [ 'foo', '"foo"', true ],
    [ String(''), 'String("")', true ],
    [ String('foo'), 'String("foo")', true ],
    [ Symbol(), 'Symbol()', true ],
    [ Symbol('foo'), 'Symbol("foo")', true ],
    [ Dog, 'class Dog', false ],
    [ arrowFunc, 'arrow function expression', false ],
    [ funcDef, 'function definition', false ],
    [ () => { return null; }, 'anonymous arrow function', false ],
    [ function () { return null; }, 'anonymous function', false ],
    [ {}, 'emty Object {}', false ],
    [ Object.create(null), 'Object.create(null)', false ],
    [ { foo: 'bar' }, '{ foo: "bar" }', false ],
    [ new Dog(), 'new Dog()', false ],
    [ new Cat(), 'new Cat()', false ],
    [ new Date(), 'new Date()', false ],
    [ new Date(2019, 0, 3, 4, 20, 1, 10), 'new Date(2019, 0, 3, 4, 20, 1, 10)', false ],
    [ new Date('invalid'), 'new Date("invalid")', false ],
    [ [], 'empty Array []', false ],
    [ [ 1 ], 'Array [ 1 ]', false ],
    [ new Map(), 'new Map()', false ],
    [ new Map([[ 'one', 1 ], [ 'two', 2 ]]), 'new Map([[ "one", 1 ], [ "two", 2 ]])', false ],
    [ new Set(), 'new Set()', false ],
    [ new Set([ 1, 2 ]), 'new Set([ 1, 2 ])', false ],
    [ new WeakMap(), 'new WeakMap()', false ],
    [ new WeakSet(), 'new WeakSet()', false ],
    [ /^start/i, '/^start/i', false ],
    [ new RegExp('^start', 'i'), 'new RegExp("^start", "i")', false ],
];
/* eslint-enable brace-style, array-bracket-spacing */

export default function testIsPrimitive() {
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

            const msg = `isPrimitive() with ${ label } (index ${ index }).`;

            assert.equal(assertions.isPrimitive(val), expectedResult, msg);
        });
    });
}
