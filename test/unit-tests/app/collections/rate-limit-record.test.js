import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import RateLimitRecord from '../../../../src/app/collections/rate-limit-record.js';


describe('RateLimitRecord', ({ it }) => {
    it('increments and returns the failure count', () => {
        const record = RateLimitRecord.forWrite({
            type: 'RateLimit',
            id: 'scope-1',
            attributes: {
                failureCount: 2,
                windowStartDate: '2026-07-27T12:00:00.000Z',
                lockedUntilDate: null,
            },
        });

        assertEqual(3, record.incrementFailureCount());
        assertEqual(3, record.get('failureCount'));
    });
});
