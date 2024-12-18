import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as assertions from '../../assertions/mod.js';

const refA = {};

function fnA() {
    return null;
}
function fnB() {
    return null;
}

const dateA = new Date(1999);
const invalidDate = new Date('invalid');

const symbolA = Symbol('A');
const symbolB = Symbol('B');

const bigIntA = BigInt(1);
const bigIntB = BigInt(2);

export const tests = [
    // Checks strings with `.includes()`.
    [ true, 'true__', 'cast Boolean to String', true ],
    [ '', ' ', 'strings "", " "', true ],
    [ 1, '1', 'numbers 1, "1"', true ],

    // Uses .test() on Regular Expressions.
    [ /^foo/, 'foobar', '/^foo/ test "foobar"', true ],
    [ /foo$/, 'foobar', '/foo$/ test "foobar"', false ],

    [ 1, 1, 'numbers 1, 1', true ],
    [ 0, 1, 'numbers 0, 1', false ],
    [ 2, 1, 'numbers 2, 1', false ],
    [ 0, 0, 'numbers 0, 0', true ],
    [ (1 / 3), (1 / 3), 'numbers (1/3), (1/3)', true ],
    [ 0, -0, 'numbers 0, -0', true ],
    [ NaN, -0, 'numbers NaN, -0', false ],
    [ 0, NaN, 'numbers 0, NaN', false ],
    [ 'foo', NaN, 'numbers "foo", NaN', false ],
    [ NaN, NaN, 'numbers NaN, NaN', true ],
    [ bigIntA, bigIntA, 'bigIntA, bigIntA', true ],
    [ bigIntA, BigInt(1), 'bigIntA, BigInt(1)', true ],
    [ 1, BigInt(1), '1, BigInt(1)', false ],
    [ bigIntA, bigIntB, 'bigIntA, bigIntB', false ],
    [ BigInt(0), BigInt(-0), 'BigInt(0), BigInt(-0)', true ],
    [ 'foo', 'foo', 'strings "foo", "foo"', true ],
    [ '', '', 'strings "", ""', true ],
    [ 'foo', String('foo'), 'strings "foo", String("foo")', true ],
    [ '1', 1, 'strings "1", 1', false ],
    [ '1', BigInt(1), 'strings "1", BigInt(1)', false ],
    [ 'a', Symbol('a'), 'strings "a", Symbol("a")', false ],
    [ symbolA, symbolA, 'symbols symbolA, symbolA', true ],
    [ symbolA, symbolB, 'symbols symbolA, symbolB', false ],
    [ symbolA, Symbol('A'), 'symbols symbolA, Symbol("A")', false ],
    [ true, true, 'bools true, true', true ],
    [ false, false, 'bools false, false', true ],
    [ true, false, 'bools true, false', false ],
    [ false, null, 'bools false, null', false ],
    [ false, 0, 'bools false, 0', false ],
    [ false, '', 'bools false, ""', false ],
    [ true, 1, 'bools true, 1', false ],
    [ true, 'x', 'bools true, "x"', false ],
    [ null, null, 'null, null', true ],
    [ null, false, 'null, false', false ],
    [ null, 0, 'null, 0', false ],
    [ null, NaN, 'null, NaN', false ],
    [ null, Object.create(null), 'null, Object.create(null)', false ],
    [ dateA, dateA, 'date dateA, dateA', true ],
    [ dateA, new Date(), 'date dateA, new Date()', false ],
    [ new Date(2019, 0, 3, 4, 20, 1, 10), new Date(2019, 0, 3, 4, 20, 1, 10), 'date new Date(), new Date()', true ],
    [ '2019', new Date(2019, 0, 3, 4, 20, 1, 10), '"2019", new Date(2019)', true ],
    [ /T09:20:01.010Z$/, new Date(2019, 0, 3, 4, 20, 1, 10), '/T00:00:00.000Z$/, new Date(2019)', true ],
    [ new Date(), new Date('invalid'), 'date new Date(), new Date("invalid")', false ],
    [ invalidDate, new Date('invalid'), 'date invalidDate, new Date("invalid")', false ],
    [ refA, {}, 'references refA, {}', false ],
    [ refA, refA, 'references refA, refA', true ],
    [ fnA, fnB, 'references fnA, fnB', false ],
    [ fnA, fnA, 'references fnA, fnA', true ],
    // eslint-disable-next-line brace-style,max-statements-per-line
    [ function () { return null; }, function () { return null; }, 'references function () { return null; }', false ],
];

export default function testDoesMatch() {
    it('pass/fails with expected values', () => {
        tests.forEach(([ a, b, label, expectedResult ], index) => {
            assert.equal(
                typeof label,
                'string',
                `Expect test label to be a string (index ${ index }).`
            );
            assert.equal(
                typeof expectedResult,
                'boolean',
                `Expect test expectedToPass to be a boolean (index ${ index }).`
            );

            const msg = `doesMatch() with ${ label } (index ${ index }).`;

            assert.equal(assertions.doesMatch(a, b), expectedResult, msg);
        });
    });
}
