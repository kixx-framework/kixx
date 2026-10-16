import { describe } from 'kixx-test';
import { assertEqual } from '../../lib/vendor/kixx-assert/mod.js';

import { parseRetryAfter } from '../../lib/parse-retry-after.js';

const NOW_MS = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');


describe('parseRetryAfter', ({ it }) => {

    it('parses delay-seconds into milliseconds', () => {
        assertEqual(5000, parseRetryAfter('5', NOW_MS));
        assertEqual(0, parseRetryAfter(' 0 ', NOW_MS));
        assertEqual(120000, parseRetryAfter('120', NOW_MS));
    });

    it('parses a future HTTP-date relative to now', () => {
        assertEqual(7000, parseRetryAfter('Wed, 21 Oct 2026 07:28:07 GMT', NOW_MS));
    });

    it('treats a past HTTP-date as no delay', () => {
        assertEqual(0, parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', NOW_MS));
    });

    it('returns null for absent or invalid values', () => {
        for (const value of [ '-1', '1.5', 'soon', '', '   ', null, undefined ]) {
            assertEqual(null, parseRetryAfter(value, NOW_MS), `value ${ String(value) }`);
        }
    });
});
