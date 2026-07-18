import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import MigrationRecord from '../../../src/app/collections/migration-record.js';


const STARTED_AT = '2026-07-17T12:00:00.000Z';
const LAST_BATCH_AT = '2026-07-17T12:01:00.000Z';
const COMPLETED_AT = '2026-07-17T12:02:00.000Z';


describe('MigrationRecord', ({ it }) => {
    it('accepts valid running, applied, and failed ledger records', () => {
        const records = [
            makeRecord(),
            makeRecord({
                status: 'applied',
                cursor: null,
                stats: { scanned: 10, updated: 4 },
                batchCount: 1,
                lastBatchAt: LAST_BATCH_AT,
                completedAt: COMPLETED_AT,
            }),
            makeRecord({
                status: 'failed',
                cursor: 'opaque-cursor',
                batchCount: 1,
                lastBatchAt: LAST_BATCH_AT,
                completedAt: COMPLETED_AT,
                error: 'The migration batch failed.',
            }),
        ];

        for (const record of records) {
            assertEqual(undefined, record.validate());
        }
    });

    it('exposes ledger attributes through domain getters', () => {
        const record = makeRecord({
            cursor: 'opaque-cursor',
            stats: { scanned: 10 },
            batchCount: 1,
            lastBatchAt: LAST_BATCH_AT,
        });

        assertEqual('running', record.status);
        assertEqual('opaque-cursor', record.cursor);
        assertEqual(10, record.stats.scanned);
        assertEqual(1, record.batchCount);
        assertEqual('admin-1', record.startedBy);
        assertEqual(STARTED_AT, record.startedAt);
        assertEqual(LAST_BATCH_AT, record.lastBatchAt);
        assertEqual(null, record.completedAt);
        assertEqual(null, record.error);
    });

    it('rejects an unknown status', () => {
        assertValidationError({ status: 'pending' }, 'status');
    });

    it('rejects a running record with completion or error state', () => {
        assertValidationError({ completedAt: COMPLETED_AT }, 'completedAt');
        assertValidationError({ error: 'Unexpected failure' }, 'error');
    });

    it('rejects an applied record without its terminal invariants', () => {
        const applied = { status: 'applied', completedAt: COMPLETED_AT };

        assertValidationError({ ...applied, cursor: 'opaque-cursor' }, 'cursor');
        assertValidationError({ ...applied, completedAt: null }, 'completedAt');
        assertValidationError({ ...applied, error: 'Unexpected failure' }, 'error');
    });

    it('rejects a failed record without completion and a non-empty error', () => {
        const failed = { status: 'failed', completedAt: COMPLETED_AT, error: 'Failed safely' };

        assertValidationError({ ...failed, completedAt: null }, 'completedAt');
        assertValidationError({ ...failed, error: null }, 'error');
        assertValidationError({ ...failed, error: '' }, 'error');
    });

    it('rejects an invalid cursor', () => {
        assertValidationError({ cursor: '' }, 'cursor');
        assertValidationError({ cursor: 42 }, 'cursor');
    });

    it('rejects an invalid batch count', () => {
        assertValidationError({ batchCount: -1 }, 'batchCount');
        assertValidationError({ batchCount: 1.5 }, 'batchCount');
    });

    it('rejects a last batch timestamp when no batch has committed', () => {
        assertValidationError({ lastBatchAt: LAST_BATCH_AT }, 'lastBatchAt');
    });

    it('rejects non-plain stats and non-finite or non-numeric stat values', () => {
        assertValidationError({ stats: [] }, 'stats');
        assertValidationError({ stats: { scanned: Infinity } }, 'stats');
        assertValidationError({ stats: { scanned: Number.NaN } }, 'stats');
        assertValidationError({ stats: { scanned: '10' } }, 'stats');
    });

    it('rejects missing run attribution', () => {
        assertValidationError({ startedBy: '' }, 'startedBy');
        assertValidationError({ startedAt: '' }, 'startedAt');
        assertValidationError({ startedAt: 'not-a-date' }, 'startedAt');
    });

    it('rejects invalid optional lifecycle timestamps', () => {
        assertValidationError({ batchCount: 1, lastBatchAt: 'not-a-date' }, 'lastBatchAt');
        assertValidationError({ completedAt: 'not-a-date' }, 'completedAt');
    });
});

function makeRecord(overrides) {
    const attributes = {
        status: 'running',
        cursor: null,
        stats: {},
        batchCount: 0,
        startedBy: 'admin-1',
        startedAt: STARTED_AT,
        lastBatchAt: null,
        completedAt: null,
        error: null,
        ...overrides,
    };

    return MigrationRecord.forWrite({
        type: 'Migration',
        id: '2026-07-17-example-noop',
        attributes,
    });
}

function assertValidationError(overrides, source) {
    const caught = catchError(() => makeRecord(overrides).validate());

    assert(caught, 'expected a ValidationError');
    assertEqual('ValidationError', caught.name);
    assert(
        caught.errors.some(error => error.source === source),
        `expected a field error for ${ source }`,
    );
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
