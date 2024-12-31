import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

class Cat {
    foo() {}
    static bar() {}
}

const cat = new Cat();

const date = new Date();

// Function *declarations*

function funcDeclaration() {
    return null;
}

async function asyncFuncDeclaration() {
    return null;
}

// Function *expressions*

// eslint-disable-next-line func-style
const funcExp = function () {
    return null;
};

// eslint-disable-next-line func-style
const asyncFuncExp = async function () {
    return null;
};

const arrowFuncExp = () => {
    return null;
};

const asyncArrowFuncExp = async () => {
    return null;
};

const foo = {
    bar() {
        return null;
    },
};

/* eslint-disable array-bracket-spacing */
export const tests = [
    [ null, 'null', 'null' ],
    [ undefined, 'undefined', 'undefined' ],
    [ true, 'true', 'Boolean(true)' ],
    [ false, 'false', 'Boolean(false)' ],
    [ 0, '0', 'Number(0)' ],
    [ 0.1, '0.1', 'Number(0.1)' ],
    [ NaN, 'NaN', 'Number(NaN)' ],
    [ BigInt(1), 'BigInt(1)', 'BigInt(1)' ],
    [ '1', '"1"', 'String(1)' ],
    [ '', 'empty String', 'String()' ],
    [ 'foo', '"foo"', 'String(foo)' ],
    [ String('foo'), 'String("foo")', 'String(foo)' ],
    [ Symbol('foo'), 'Symbol("foo")', 'Symbol(foo)' ],
    [ Cat, 'class Cat', 'class Cat {}' ],
    [ cat.constructor, 'Cat:constructor', 'class Cat {}' ],
    [ Cat.bar, 'Cat.bar', 'Function(bar)' ],
    [ cat.foo, 'Cat:foo', 'Function(foo)' ],
    [ foo.bar, 'foo.bar()', 'Function(bar)' ],
    [ funcDeclaration, 'function declaration', 'Function(funcDeclaration)' ],
    [ asyncFuncDeclaration, 'async function declaration', 'AsyncFunction(asyncFuncDeclaration)' ],
    [ function () {}, 'anonymous function declaration', 'Function(function)' ],
    [ async function () {}, 'async anonymous function declaration', 'AsyncFunction(function)' ],
    [ () => {}, 'arrow function declaration', 'Function(function)' ],
    [ async () => {}, 'async arrow function declaration', 'AsyncFunction(function)' ],
    [ funcExp, 'function expression', 'Function(funcExp)' ],
    [ asyncFuncExp, 'async function expression', 'AsyncFunction(asyncFuncExp)' ],
    [ arrowFuncExp, 'arrow function expression', 'Function(arrowFuncExp)' ],
    [ asyncArrowFuncExp, 'async arrow function expression', 'AsyncFunction(asyncArrowFuncExp)' ],
    [ { foo: 'bar' }, 'emty Object {}', 'Object({})' ],
    [ date, 'new Date()', `Date(${ date.toISOString() })` ],
    [ new Date('invalid'), 'new Date("invalid")', 'Date(Invalid)' ],
    [ [ 3, 4, 9 ], 'Array []', 'Array([0..2])' ],
    [ new Map(), 'new Map()', 'Map()' ],
    [ new Set(), 'new Set()', 'Set()' ],
    [ new WeakMap(), 'new WeakMap()', 'WeakMap()' ],
    [ new WeakSet(), 'new WeakSet()', 'WeakSet()' ],
    [ /^foo[.]+bar$/, '/^foo[.]+bar$/', 'RegExp(/^foo[.]+bar$/)' ],
    [ new RegExp('^start', 'i'), 'new RegExp("^start", "i")', 'RegExp(/^start/i)' ],
];
/* eslint-enable array-bracket-spacing */


export default function testToFriendlyString() {
    it('pass/fails with expected values', () => {
        tests.forEach(([ val, label, expectedResult ], index) => {
            assert.equal(
                typeof label,
                'string',
                `Expect test label to be a string (index ${ index }).`
            );
            assert.equal(
                typeof expectedResult,
                'string',
                `Expect test expectedResult to be a boolean (index ${ index }).`
            );

            const msg = `toFriendlyString() with ${ label } (index ${ index }).`;

            assert.equal(assertions.toFriendlyString(val), expectedResult, msg);
        });
    });
}
