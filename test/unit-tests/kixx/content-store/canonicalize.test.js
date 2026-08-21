import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { canonicalize, compareStrings } from '../../../../src/kixx/content-store/canonicalize.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('canonicalize', ({ describe }) => {

    describe('compareStrings()', ({ it }) => {
        it('returns -1 when the left operand sorts first', () => {
            assertEqual(-1, compareStrings('a', 'b'));
        });

        it('returns 1 when the left operand sorts last', () => {
            assertEqual(1, compareStrings('b', 'a'));
        });

        it('returns 0 for equal strings', () => {
            assertEqual(0, compareStrings('a', 'a'));
        });
    });

    describe('canonicalize()', ({ it }) => {
        it('serializes null, booleans, and strings as JSON', () => {
            assertEqual('null', canonicalize(null));
            assertEqual('true', canonicalize(true));
            assertEqual('"a"', canonicalize('a'));
        });

        it('serializes finite numbers as JSON', () => {
            assertEqual('42', canonicalize(42));
            assertEqual('-1.5', canonicalize(-1.5));
        });

        it('throws TypeError for non-finite numbers', () => {
            const caught = catchError(() => canonicalize(NaN));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('non-finite number', caught.message);
        });

        it('throws TypeError for unsupported types', () => {
            const caught = catchError(() => canonicalize(undefined));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('unsupported type', caught.message);
        });

        it('serializes arrays by recursively canonicalizing each element', () => {
            assertEqual('[1,2,3]', canonicalize([ 1, 2, 3 ]));
        });

        it('sorts object keys regardless of insertion order', () => {
            assertEqual('{"a":2,"b":1}', canonicalize({ b: 1, a: 2 }));
        });

        it('omits object properties whose value is undefined', () => {
            assertEqual('{"b":1}', canonicalize({ a: undefined, b: 1 }));
        });

        it('canonicalizes nested structures depth-first', () => {
            assertEqual('[1,{"a":1,"b":2}]', canonicalize([ 1, { b: 2, a: 1 } ]));
        });

        it('produces identical output regardless of key insertion order', () => {
            assertEqual(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
        });
    });
});
