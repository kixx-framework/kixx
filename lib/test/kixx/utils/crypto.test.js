import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import {
    generateNumericCode,
    generateShortId,
    timingSafeEqual,
} from '../../../kixx/utils/crypto.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('crypto', ({ describe }) => {

    describe('generateShortId', ({ it }) => {
        it('returns a 22-character Base62 string', () => {
            const id = generateShortId();

            assertEqual('string', typeof id);
            assertEqual(22, id.length);
            assertMatches(/^[0-9A-Za-z]{22}$/, id);
        });

        it('generates distinct IDs across many calls', () => {
            const count = 1000;
            const ids = new Set();

            for (let i = 0; i < count; i += 1) {
                ids.add(generateShortId());
            }

            assertEqual(count, ids.size);
        });

        it('left-pads short values to the full width with leading zeros', () => {
            const tracker = new MockTracker();

            // A freshly allocated Uint8Array is zero-filled, so a no-op stand-in
            // for getRandomValues produces the all-zero (smallest) random value.
            tracker.method(crypto, 'getRandomValues', (bytes) => bytes);

            const id = generateShortId();
            tracker.reset();

            assertEqual('0'.repeat(22), id);
        });

        it('encodes the random bytes as a big-endian Base62 integer', () => {
            const tracker = new MockTracker();

            // Set only the least-significant byte to 62, making the 128-bit value
            // exactly 62, which must encode to the Base62 digits '1' then '0'.
            tracker.method(crypto, 'getRandomValues', (bytes) => {
                bytes[bytes.length - 1] = 62;
                return bytes;
            });

            const id = generateShortId();
            tracker.reset();

            assertEqual('0'.repeat(20) + '10', id);
        });
    });

    describe('generateNumericCode', ({ it }) => {
        it('returns exactly the requested number of decimal digits', () => {
            for (let i = 0; i < 100; i += 1) {
                assertMatches(/^[0-9]{6}$/, generateNumericCode(6));
            }
        });

        it('rejects biased bytes and keeps leading zeros', () => {
            const tracker = new MockTracker();
            const draws = [ 255, 250, 0, 13, 249 ];

            // 255 and 250 fall in the biased tail and must be discarded.
            tracker.method(crypto, 'getRandomValues', (bytes) => {
                bytes[0] = draws.shift();
                return bytes;
            });

            const code = generateNumericCode(3);
            tracker.reset();

            assertEqual('039', code);
        });

        it('throws for a length that is not a positive integer', () => {
            for (const length of [ 0, -1, 1.5, '6', undefined ]) {
                assertEqual('AssertionError', catchError(() => generateNumericCode(length))?.name);
            }
        });
    });

    describe('timingSafeEqual', ({ it }) => {
        it('reports identical strings as equal', () => {
            assert(timingSafeEqual('abc123', 'abc123'));
            assert(timingSafeEqual('', ''));
        });

        it('reports different or differently sized strings as unequal', () => {
            assertFalsy(timingSafeEqual('abc123', 'abc124'));
            assertFalsy(timingSafeEqual('abc', 'abc1'));
        });

        it('throws when either argument is not a string', () => {
            assertEqual('AssertionError', catchError(() => timingSafeEqual('abc', null))?.name);
            assertEqual('AssertionError', catchError(() => timingSafeEqual(new Uint8Array(3), 'abc'))?.name);
        });
    });
});
