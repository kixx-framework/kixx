import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { validateBatchResult } from '../../../../../src/app/transaction-scripts/migrations/lib/validate-batch-result.js';


describe('validateBatchResult', ({ it }) => {
    it('returns valid terminal and non-terminal batch results unchanged', () => {
        const terminal = { done: true, cursor: null, stats: { scanned: 1 } };
        const continuing = { done: false, cursor: 'next-cursor', stats: { scanned: 10 } };

        assertEqual(terminal, validateBatchResult(terminal, 'input-cursor'));
        assertEqual(continuing, validateBatchResult(continuing, 'input-cursor'));
    });

    it('rejects a result that is not a plain object', () => {
        assertInvalid(null);
        assertInvalid([]);
    });

    it('rejects a non-boolean done value', () => {
        assertInvalid({ done: 'true', cursor: null, stats: {} });
    });

    it('rejects a terminal result with a non-null cursor', () => {
        assertInvalid({ done: true, cursor: 'next-cursor', stats: {} });
    });

    it('rejects a non-terminal result without a non-empty cursor', () => {
        assertInvalid({ done: false, cursor: null, stats: {} });
        assertInvalid({ done: false, cursor: '', stats: {} });
    });

    it('rejects a non-terminal result that does not advance its cursor', () => {
        assertInvalid(
            { done: false, cursor: 'input-cursor', stats: {} },
            'input-cursor',
        );
    });

    it('rejects non-plain stats and non-finite or non-numeric values', () => {
        assertInvalid({ done: true, cursor: null, stats: [] });
        assertInvalid({ done: true, cursor: null, stats: { scanned: Infinity } });
        assertInvalid({ done: true, cursor: null, stats: { scanned: Number.NaN } });
        assertInvalid({ done: true, cursor: null, stats: { scanned: '1' } });
    });
});

function assertInvalid(result, inputCursor = null) {
    const caught = catchError(() => validateBatchResult(result, inputCursor));

    assert(caught, 'expected an invalid batch result error');
    assertEqual('InvalidMigrationBatchResultError', caught.name);
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
