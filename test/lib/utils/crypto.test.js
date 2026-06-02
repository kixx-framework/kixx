import { describe, MockTracker } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import { generateShortId } from '../../../lib/utils/crypto.js';


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
});
