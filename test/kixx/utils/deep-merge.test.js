import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined, assertMatches } from 'kixx-assert';

import deepMerge from '../../../src/kixx/utils/deep-merge.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('deepMerge', ({ describe }) => {

    describe('merging values', ({ it }) => {
        it('copies source properties into the target and returns the same target', () => {
            const target = { a: 1 };
            const result = deepMerge(target, { b: 2 });

            assertEqual(target, result);
            assertEqual(1, result.a);
            assertEqual(2, result.b);
        });

        it('applies sources in argument order so later sources win', () => {
            const result = deepMerge({}, { a: 1, b: 1 }, { b: 2 }, { b: 3 });

            assertEqual(1, result.a);
            assertEqual(3, result.b);
        });

        it('returns the unchanged target when no sources are given', () => {
            const target = { a: 1 };
            const result = deepMerge(target);

            assertEqual(target, result);
            assertEqual(1, result.a);
            assertEqual(1, Object.keys(result).length);
        });

        it('accumulates nested merges across multiple sources', () => {
            const result = deepMerge({}, { a: { x: 1 } }, { a: { y: 2 } }, { b: 3 });

            assertEqual(1, result.a.x);
            assertEqual(2, result.a.y);
            assertEqual(3, result.b);
        });
    });

    describe('nested plain objects', ({ it }) => {
        it('merges nested plain objects recursively, preserving target-only keys', () => {
            const result = deepMerge({ a: { x: 1 } }, { a: { y: 2 } });

            assertEqual(1, result.a.x);
            assertEqual(2, result.a.y);
        });

        it('merges into the existing nested target object in place', () => {
            const nested = { x: 1 };
            const target = { a: nested };
            const result = deepMerge(target, { a: { y: 2 } });

            assertEqual(nested, result.a);
            assertEqual(1, result.a.x);
            assertEqual(2, result.a.y);
        });

        it('replaces a non-plain target value with a fresh merge when the source value is a plain object', () => {
            const source = { a: { x: 1 } };
            const result = deepMerge({ a: 5 }, source);

            assertEqual(1, result.a.x);
            assert(result.a !== source.a, 'merges into a fresh object, not the source object');
        });
    });

    describe('replacing arrays and non-plain values', ({ it }) => {
        it('replaces arrays instead of merging them element by element', () => {
            const result = deepMerge({ a: [ 1, 2, 3 ] }, { a: [ 9 ] });

            assert(Array.isArray(result.a), 'value remains an array');
            assertEqual(1, result.a.length);
            assertEqual(9, result.a[0]);
        });

        it('replaces a plain object target value with a primitive source value', () => {
            const result = deepMerge({ a: { x: 1 } }, { a: 5 });

            assertEqual(5, result.a);
        });

        it('replaces a plain object target value with an array source value', () => {
            const result = deepMerge({ a: { x: 1 } }, { a: [ 1, 2 ] });

            assert(Array.isArray(result.a), 'value becomes an array');
            assertEqual(2, result.a.length);
        });
    });

    describe('copy semantics', ({ it }) => {
        it('deep-copies source plain objects so later target mutation does not reach the source', () => {
            const source = { a: { x: 1 } };
            const result = deepMerge({}, source);

            result.a.x = 99;

            assert(result.a !== source.a, 'target nested object is a distinct reference');
            assertEqual(1, source.a.x);
        });

        it('deep-copies source arrays and the objects inside them', () => {
            const source = { a: [ { x: 1 } ] };
            const result = deepMerge({}, source);

            result.a[0].x = 99;
            result.a.push('extra');

            assert(result.a !== source.a, 'target array is a distinct reference');
            assert(result.a[0] !== source.a[0], 'array element is a distinct reference');
            assertEqual(1, source.a[0].x);
            assertEqual(1, source.a.length);
        });

        it('shares non-plain values by reference instead of cloning them', () => {
            const date = new Date();
            const fn = () => {};

            class Widget {}
            const widget = new Widget();

            const source = { date, fn, widget };
            const result = deepMerge({}, source);

            // Use strict === rather than assertEqual: isEqual() compares valid
            // Dates by time value, so assertEqual would also pass for a cloned
            // Date and would not prove the instance is shared by reference.
            assert(result.date === date, 'Date instance is shared by reference');
            assert(result.fn === fn, 'function is shared by reference');
            assert(result.widget === widget, 'class instance is shared by reference');
        });
    });

    describe('own enumerable properties', ({ it }) => {
        it('ignores symbol-keyed source properties', () => {
            const sym = Symbol('hidden');
            const result = deepMerge({}, { [sym]: 1, a: 2 });

            assertEqual(2, result.a);
            assertUndefined(result[sym]);
        });

        it('treats null-prototype objects as plain, as both target and nested value', () => {
            const target = Object.create(null);
            target.a = 1;

            const nested = Object.create(null);
            nested.x = 1;

            const result = deepMerge(target, { b: 2, c: nested });

            assertEqual(target, result);
            assertEqual(1, result.a);
            assertEqual(2, result.b);
            assertEqual(1, result.c.x);
            assert(result.c !== nested, 'null-prototype nested value is deep-copied');
        });
    });

    describe('prototype pollution guard', ({ it }) => {
        it('skips __proto__ keys and does not pollute the global prototype', () => {
            const source = JSON.parse('{ "__proto__": { "polluted": true } }');
            const target = {};

            const result = deepMerge(target, source);

            assertUndefined(result.polluted);
            assertUndefined(({}).polluted);
            assertEqual(0, Object.keys(result).length);
        });
    });

    describe('validation', ({ it }) => {
        it('throws a TypeError when the target is not a plain object', () => {
            const invalidTargets = [ null, undefined, 42, 'str', [ 1 ], new Date() ];

            for (const target of invalidTargets) {
                const caught = catchError(() => deepMerge(target, { a: 1 }));

                assert(caught, `expected an error for ${ String(target) }`);
                assertEqual('TypeError', caught.name);
                assertMatches('deepMerge() target must be a plain object.', caught.message);
            }
        });

        it('throws a TypeError when a source is not a plain object', () => {
            const invalidSources = [ null, undefined, 42, 'str', [ 1 ], new Date() ];

            for (const source of invalidSources) {
                const caught = catchError(() => deepMerge({}, source));

                assert(caught, `expected an error for ${ String(source) }`);
                assertEqual('TypeError', caught.name);
                assertMatches('deepMerge() sources must be plain objects.', caught.message);
            }
        });
    });
});
