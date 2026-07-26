import { describe } from 'kixx-test';
import { assert, assertEqual, assertNotEqual } from 'kixx-assert';

import { accumulateStats } from '../../../../../src/app/transaction-scripts/migrations/lib/accumulate-stats.js';


describe('accumulateStats', ({ it }) => {
    it('adds matching counters and defaults missing previous counters to zero', () => {
        const result = accumulateStats(
            { scanned: 10, updated: 2 },
            { scanned: 5, skipped: 3 },
        );

        assertEqual(15, result.scanned);
        assertEqual(2, result.updated);
        assertEqual(3, result.skipped);
    });

    it('returns a new object without mutating either input', () => {
        const previous = { scanned: 10 };
        const batch = { scanned: 5 };
        const result = accumulateStats(previous, batch);

        assertNotEqual(previous, result);
        assertNotEqual(batch, result);
        assertEqual(10, previous.scanned);
        assertEqual(5, batch.scanned);
        assertEqual(15, result.scanned);
    });

    it('rejects malformed counters and a non-finite accumulated sum', () => {
        assertAssertionError(() => accumulateStats([], {}));
        assertAssertionError(() => accumulateStats({}, { scanned: '1' }));
        assertAssertionError(() => accumulateStats(
            { scanned: Number.MAX_VALUE },
            { scanned: Number.MAX_VALUE },
        ));
    });
});

function assertAssertionError(fn) {
    const caught = catchError(fn);

    assert(caught, 'expected an AssertionError');
    assertEqual('AssertionError', caught.name);
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
