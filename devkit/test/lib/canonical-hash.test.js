import { describe } from 'kixx-test';
import { assert, assertEqual, assertNotEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import { canonicalize, sha256Hex, hashValue } from '../../lib/canonical-hash.js';


describe('canonical-hash', ({ it }) => {
    it('canonicalizes objects with the same entries in different order identically', () => {
        const a = { b: 1, a: 2, c: 3 };
        const b = { c: 3, a: 2, b: 1 };

        assertEqual(canonicalize(a), canonicalize(b));
        assertEqual(hashValue(a), hashValue(b));
    });

    it('sorts nested objects at every depth', () => {
        const value = { z: { b: 1, a: 2 }, a: 1 };

        assertEqual('{"a":1,"z":{"a":2,"b":1}}', canonicalize(value));
    });

    it('preserves array order', () => {
        const a = { list: [ 1, 2, 3 ] };
        const b = { list: [ 3, 2, 1 ] };

        assertNotEqual(canonicalize(a), canonicalize(b));
    });

    it('produces output with no whitespace', () => {
        const text = canonicalize({ a: 1, b: [ 1, 2 ] });

        assert(!/\s/.test(text), 'expected no whitespace in canonical output');
    });

    it('omits undefined object values and keeps null', () => {
        const text = canonicalize({ a: undefined, b: null, c: 1 });

        assertEqual('{"b":null,"c":1}', text);
    });

    it('converts an undefined array element to null', () => {
        const text = canonicalize([ 1, undefined, 3 ]);

        assertEqual('[1,null,3]', text);
    });

    it('round-trips numbers, booleans, null, and strings with unusual characters', () => {
        const value = {
            n: 3.14,
            bool: true,
            nothing: null,
            text: 'héllo "world"\nline two',
        };

        const digestOne = hashValue(value);
        const digestTwo = hashValue(JSON.parse(JSON.stringify(value)));

        assertEqual(digestOne, digestTwo);
    });

    it('throws on a circular reference', () => {
        const value = { a: 1 };
        value.self = value;

        const caught = catchError(() => canonicalize(value));

        assert(caught instanceof TypeError, 'expected a TypeError');
    });

    it('throws on a function value', () => {
        const caught = catchError(() => canonicalize({ fn: () => 1 }));

        assert(caught instanceof TypeError, 'expected a TypeError');
    });

    it('throws on a BigInt value', () => {
        const caught = catchError(() => canonicalize({ big: 10n }));

        assert(caught instanceof TypeError, 'expected a TypeError');
    });

    it('returns a 64-character lowercase hex digest matching a known vector', () => {
        const digest = sha256Hex('');

        assertEqual(64, digest.length);
        assertMatches(/^[0-9a-f]{64}$/, digest);
        assertEqual(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            digest,
        );
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
