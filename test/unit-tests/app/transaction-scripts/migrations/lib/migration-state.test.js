import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import {
    computeCommittedState,
    computeFailedState,
    computeRunPreparation,
} from '../../../../../src/app/transaction-scripts/migrations/lib/migration-state.js';


const ORIGINAL_START = '2026-07-17T12:00:00.000Z';
const NOW = '2026-07-17T12:05:00.000Z';


describe('migration state', ({ it }) => {
    it('prepares a fresh running seed when no ledger exists', () => {
        const preparation = computeRunPreparation({
            existing: null,
            force: true,
            adminId: 'admin-new',
            now: NOW,
        });

        assertEqual('create', preparation.action);
        assertFreshSeed(preparation.seed);
    });

    it('resumes a running ledger cursor even when force is true', () => {
        const existing = makeState({ cursor: 'committed-cursor' });
        const preparation = computeRunPreparation({
            existing,
            force: true,
            adminId: 'admin-new',
            now: NOW,
        });

        assertEqual('resume', preparation.action);
        assertEqual('committed-cursor', preparation.startCursor);
        assertEqual('admin-original', existing.startedBy);
    });

    it('resumes a failed run without force and retains its committed progress and attribution', () => {
        const existing = makeState({
            status: 'failed',
            cursor: 'committed-cursor',
            stats: { scanned: 10 },
            batchCount: 1,
            lastBatchAt: ORIGINAL_START,
            completedAt: ORIGINAL_START,
            error: 'Previous failure',
        });
        const preparation = computeRunPreparation({
            existing,
            force: false,
            adminId: 'admin-new',
            now: NOW,
        });

        assertEqual('resume-failed', preparation.action);
        assertEqual('committed-cursor', preparation.startCursor);
        assertEqual('running', preparation.state.status);
        assertEqual('committed-cursor', preparation.state.cursor);
        assertEqual(10, preparation.state.stats.scanned);
        assertEqual(1, preparation.state.batchCount);
        assertEqual('admin-original', preparation.state.startedBy);
        assertEqual(ORIGINAL_START, preparation.state.startedAt);
        assertEqual(null, preparation.state.completedAt);
        assertEqual(null, preparation.state.error);
        assertEqual('failed', existing.status);
    });

    it('resets a failed run when force is true', () => {
        const preparation = computeRunPreparation({
            existing: makeState({ status: 'failed', completedAt: ORIGINAL_START, error: 'Failure' }),
            force: true,
            adminId: 'admin-new',
            now: NOW,
        });

        assertEqual('reset', preparation.action);
        assertFreshSeed(preparation.seed);
    });

    it('rejects an applied run when force is false', () => {
        const preparation = computeRunPreparation({
            existing: makeState({ status: 'applied', completedAt: ORIGINAL_START }),
            force: false,
            adminId: 'admin-new',
            now: NOW,
        });

        assertEqual('reject-applied', preparation.action);
        assertEqual(1, Object.keys(preparation).length);
    });

    it('resets an applied run when force is true', () => {
        const preparation = computeRunPreparation({
            existing: makeState({ status: 'applied', completedAt: ORIGINAL_START }),
            force: true,
            adminId: 'admin-new',
            now: NOW,
        });

        assertEqual('reset', preparation.action);
        assertFreshSeed(preparation.seed);
    });

    it('commits a non-terminal batch as running with accumulated progress', () => {
        const base = makeState({ cursor: 'previous-cursor', batchCount: 2 });
        const committed = computeCommittedState({
            base,
            batchResult: { done: false, cursor: 'next-cursor', stats: { scanned: 5 } },
            accumulatedStats: { scanned: 15 },
            now: NOW,
        });

        assertEqual('running', committed.status);
        assertEqual('next-cursor', committed.cursor);
        assertEqual(15, committed.stats.scanned);
        assertEqual(3, committed.batchCount);
        assertEqual(NOW, committed.lastBatchAt);
        assertEqual(null, committed.completedAt);
        assertEqual(null, committed.error);
        assertEqual('previous-cursor', base.cursor);
    });

    it('commits a terminal batch as applied with a null cursor', () => {
        const committed = computeCommittedState({
            base: makeState({ cursor: 'previous-cursor', batchCount: 2 }),
            batchResult: { done: true, cursor: null, stats: { scanned: 5 } },
            accumulatedStats: { scanned: 15 },
            now: NOW,
        });

        assertEqual('applied', committed.status);
        assertEqual(null, committed.cursor);
        assertEqual(3, committed.batchCount);
        assertEqual(NOW, committed.lastBatchAt);
        assertEqual(NOW, committed.completedAt);
        assertEqual(null, committed.error);
    });

    it('records failure while preserving the last committed progress', () => {
        const base = makeState({
            cursor: 'committed-cursor',
            stats: { scanned: 10 },
            batchCount: 2,
            lastBatchAt: ORIGINAL_START,
        });
        const failed = computeFailedState({
            base,
            errorMessage: 'The migration batch failed safely.',
            now: NOW,
        });

        assertEqual('failed', failed.status);
        assertEqual('committed-cursor', failed.cursor);
        assertEqual(10, failed.stats.scanned);
        assertEqual(2, failed.batchCount);
        assertEqual(ORIGINAL_START, failed.lastBatchAt);
        assertEqual(NOW, failed.completedAt);
        assertEqual('The migration batch failed safely.', failed.error);
        assertEqual('running', base.status);
    });
});

function makeState(overrides) {
    return {
        status: 'running',
        cursor: null,
        stats: {},
        batchCount: 0,
        startedBy: 'admin-original',
        startedAt: ORIGINAL_START,
        lastBatchAt: null,
        completedAt: null,
        error: null,
        ...overrides,
    };
}

function assertFreshSeed(seed) {
    assertEqual(9, Object.keys(seed).length);
    assertEqual('running', seed.status);
    assertEqual(null, seed.cursor);
    assertEqual(0, Object.keys(seed.stats).length);
    assertEqual(0, seed.batchCount);
    assertEqual('admin-new', seed.startedBy);
    assertEqual(NOW, seed.startedAt);
    assertEqual(null, seed.lastBatchAt);
    assertEqual(null, seed.completedAt);
    assertEqual(null, seed.error);
}
