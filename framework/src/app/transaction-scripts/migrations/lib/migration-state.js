import {
    assert,
    assertNonEmptyString,
    isPlainObject,
} from '../../../../kixx/assertions/mod.js';


const VALID_STATUSES = new Set([ 'running', 'failed', 'applied' ]);


/**
 * Selects and prepares the lifecycle action required before one real batch.
 * @param {Object} args - Run preparation inputs.
 * @param {Object|null} args.existing - Current ledger attributes, or null before the first run.
 * @param {boolean} args.force - Whether terminal state may be reset.
 * @param {string} args.adminId - Stable id of the admin requesting this run.
 * @param {string} args.now - ISO date-time used for a fresh run.
 * @returns {Object} Preparation action and its cursor, seed, or prepared state.
 * @throws {AssertionError} When preparation inputs violate internal contracts.
 */
export function computeRunPreparation(args) {
    const {
        existing,
        force,
        adminId,
        now,
    } = args ?? {};

    assert(force === true || force === false, 'computeRunPreparation() force must be a boolean');
    assertNonEmptyString(adminId, 'computeRunPreparation() adminId');
    assertNonEmptyString(now, 'computeRunPreparation() now');

    if (existing === null) {
        return {
            action: 'create',
            seed: createFreshSeed(adminId, now),
        };
    }

    assertState(existing, 'computeRunPreparation() existing');

    if (existing.status === 'running') {
        return {
            action: 'resume',
            startCursor: existing.cursor,
        };
    }

    if (existing.status === 'applied' && !force) {
        return { action: 'reject-applied' };
    }

    if (force) {
        return {
            action: 'reset',
            seed: createFreshSeed(adminId, now),
        };
    }

    return {
        action: 'resume-failed',
        startCursor: existing.cursor,
        state: {
            ...existing,
            status: 'running',
            stats: { ...existing.stats },
            completedAt: null,
            error: null,
        },
    };
}

/**
 * Computes ledger state after one successful, validated real batch.
 * @param {Object} args - Successful commit inputs.
 * @param {Object} args.base - Prepared running ledger attributes.
 * @param {Object} args.batchResult - Validated migration batch result.
 * @param {Object} args.accumulatedStats - Finite counters including this batch.
 * @param {string} args.now - ISO date-time of the successful batch.
 * @returns {Object} New ledger attributes ready for a version-guarded commit.
 * @throws {AssertionError} When commit inputs violate internal contracts.
 */
export function computeCommittedState(args) {
    const {
        base,
        batchResult,
        accumulatedStats,
        now,
    } = args ?? {};

    assertState(base, 'computeCommittedState() base');
    assert(isPlainObject(batchResult), 'computeCommittedState() batchResult must be a plain object');
    assert(
        batchResult.done === true || batchResult.done === false,
        'computeCommittedState() batchResult.done must be a boolean',
    );
    assertFiniteStats(accumulatedStats, 'computeCommittedState() accumulatedStats');
    assertNonEmptyString(now, 'computeCommittedState() now');

    return {
        ...base,
        status: batchResult.done ? 'applied' : 'running',
        cursor: batchResult.done ? null : batchResult.cursor,
        stats: { ...accumulatedStats },
        batchCount: base.batchCount + 1,
        lastBatchAt: now,
        completedAt: batchResult.done ? now : null,
        error: null,
    };
}

/**
 * Computes failed ledger state without advancing committed progress.
 * @param {Object} args - Failure bookkeeping inputs.
 * @param {Object} args.base - Last prepared ledger attributes.
 * @param {string} args.errorMessage - Client-safe failure detail for operators.
 * @param {string} args.now - ISO date-time when the run failed.
 * @returns {Object} New failed ledger attributes preserving committed progress.
 * @throws {AssertionError} When failure inputs violate internal contracts.
 */
export function computeFailedState(args) {
    const {
        base,
        errorMessage,
        now,
    } = args ?? {};

    assertState(base, 'computeFailedState() base');
    assertNonEmptyString(errorMessage, 'computeFailedState() errorMessage');
    assertNonEmptyString(now, 'computeFailedState() now');

    return {
        ...base,
        status: 'failed',
        stats: { ...base.stats },
        completedAt: now,
        error: errorMessage,
    };
}

function createFreshSeed(adminId, now) {
    return {
        status: 'running',
        cursor: null,
        stats: {},
        batchCount: 0,
        startedBy: adminId,
        startedAt: now,
        lastBatchAt: null,
        completedAt: null,
        error: null,
    };
}

function assertState(state, label) {
    assert(isPlainObject(state), `${ label } must be a plain object`);
    assert(VALID_STATUSES.has(state.status), `${ label }.status is invalid`);
    assertFiniteStats(state.stats, `${ label }.stats`);
    assert(
        Number.isInteger(state.batchCount) && state.batchCount >= 0,
        `${ label }.batchCount must be a non-negative integer`,
    );
}

function assertFiniteStats(stats, label) {
    assert(isPlainObject(stats), `${ label } must be a plain object`);
    assert(
        Object.values(stats).every(Number.isFinite),
        `${ label } values must be finite numbers`,
    );
}
