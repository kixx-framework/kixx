import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

class Cat {
    foo() {}
    static bar() {}
}

const cat = new Cat();

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
    [ Cat, 'class Cat', true ],
    [ cat.constructor, 'Cat constructor', true ],
    [ Cat.bar, 'Cat.bar', true ],
    [ cat.foo, 'Cat:foo', true ],
    [ foo.bar, 'foo.bar()', true ],
    [ funcDeclaration, 'function declaration', true ],
    [ asyncFuncDeclaration, 'async function declaration', true ],
    [ function () {}, 'anonymous function declaration', true ],
    [ async function () {}, 'async anonymous function declaration', true ],
    [ () => {}, 'arrow function declaration', true ],
    [ async () => {}, 'async arrow function declaration', true ],
    [ funcExp, 'function expression', true ],
    [ asyncFuncExp, 'async function expression', true ],
    [ arrowFuncExp, 'arrow function expression', true ],
    [ asyncArrowFuncExp, 'async arrow function expression', true ],
    [ {}, 'empty Object {}', false],
    [ new Date(), 'new Date()', false],
    [ new Date('invalid'), 'new Date("invalid")', false ],
    [ [], 'empty Array []', false],
    [ new Map(), 'new Map()', false],
    [ new Set(), 'new Set()', false],
    [ new RegExp('^start', 'i'), 'new RegExp("^start", "i")', false ],
];
/* eslint-enable array-bracket-spacing, no-undefined */

export default function testIsFunction() {
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

            const msg = `isFunction() with ${ label } (index ${ index }).`;

            assert.equal(assertions.isFunction(val), expectedResult, msg);
        });
    });
}
