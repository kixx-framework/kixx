import {
    assert,
    isPlainObject,
} from '../../../../kixx/assertions/mod.js';


/**
 * Adds one batch of finite counters to previously committed migration stats.
 * @param {Object} previousStats - Counters from successfully committed batches.
 * @param {Object} batchStats - Finite counters reported for the current batch.
 * @returns {Object} New accumulated counters; neither input is mutated.
 * @throws {AssertionError} When either input or an accumulated sum is invalid.
 */
export function accumulateStats(previousStats, batchStats) {
    assertFiniteStats(previousStats, 'accumulateStats() previousStats');
    assertFiniteStats(batchStats, 'accumulateStats() batchStats');

    const accumulated = { ...previousStats };

    for (const [ name, value ] of Object.entries(batchStats)) {
        const total = (accumulated[name] ?? 0) + value;
        assert(
            Number.isFinite(total),
            `accumulateStats() accumulated "${ name }" must remain finite`,
        );
        accumulated[name] = total;
    }

    return accumulated;
}

function assertFiniteStats(stats, label) {
    assert(isPlainObject(stats), `${ label } must be a plain object`);
    assert(
        Object.values(stats).every(Number.isFinite),
        `${ label } values must be finite numbers`,
    );
}
