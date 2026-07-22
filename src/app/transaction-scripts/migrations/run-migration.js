import { getMigration } from '../../migrations/mod.js';
import {
    assert,
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';
import {
    AssertionError,
    ConflictError,
    NotFoundError,
} from '../../../kixx/errors/mod.js';
import { accumulateStats } from './lib/accumulate-stats.js';
import {
    computeCommittedState,
    computeFailedState,
    computeRunPreparation,
} from './lib/migration-state.js';
import { validateBatchResult } from './lib/validate-batch-result.js';


/**
 * Advances exactly one real or dry migration batch.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} params - Validated migration execution inputs.
 * @param {string} params.id - Registered migration id.
 * @param {boolean} params.dryRun - Whether ledger and application writes are forbidden.
 * @param {boolean} params.force - Whether eligible terminal ledger state should restart.
 * @param {string|null} params.cursor - Caller-owned dry-run cursor; ignored for real runs.
 * @param {string} params.startedBy - Stable admin id requesting the run.
 * @param {string} params.now - ISO date-time for this request's transitions.
 * @returns {Promise<{done: boolean, cursor: string|null, stats: Object, status: string, dryRun: boolean}>} Batch outcome.
 * @throws {NotFoundError} When id is not registered.
 * @throws {ConflictError} When ledger state or concurrency prevents this batch.
 * @throws {AssertionError} When migration or persistence contracts are broken.
 */
export async function runMigration(context, params) {
    const {
        id,
        dryRun,
        force,
        cursor,
        startedBy,
        now,
    } = params ?? {};

    assertRunInputs({ id, dryRun, force, cursor, startedBy, now });

    const migration = getMigration(id);
    if (!migration) {
        throw new NotFoundError(`Migration "${ id }" is not registered`);
    }

    if (dryRun) {
        return await runDryBatch(context, migration, cursor ?? null);
    }

    const migrationLedger = context.getCollection('Migration');
    const preparedRecord = await prepareRealRun(
        context,
        migrationLedger,
        { id, force, startedBy, now },
    );
    const startCursor = preparedRecord.cursor;

    let batchResult;
    try {
        batchResult = await migration.migrate(context, {
            cursor: startCursor,
            dryRun: false,
        });
    } catch (cause) {
        await recordFailedRun(context, migrationLedger, preparedRecord, cause, now);
        throwMigrationFailure(cause);
    }

    let committedState;
    try {
        validateBatchResult(batchResult, startCursor);
        const accumulatedStats = accumulateStats(preparedRecord.stats, batchResult.stats);
        committedState = computeCommittedState({
            base: getRecordState(preparedRecord),
            batchResult,
            accumulatedStats,
            now,
        });
    } catch (cause) {
        await recordFailedRun(context, migrationLedger, preparedRecord, cause, now);
        throw new AssertionError('Migration returned an invalid batch result', { cause });
    }

    preparedRecord.merge(committedState);
    const committedRecord = await updateLedgerRecord(
        context,
        migrationLedger,
        preparedRecord,
        'committing migration batch progress',
    );

    return presentRealResult(committedRecord);
}

function assertRunInputs(args) {
    const {
        id,
        dryRun,
        force,
        cursor,
        startedBy,
        now,
    } = args;

    assertNonEmptyString(id, 'runMigration() params.id');
    assert(dryRun === true || dryRun === false, 'runMigration() params.dryRun must be a boolean');
    assert(force === true || force === false, 'runMigration() params.force must be a boolean');
    assert(cursor === null || isNonEmptyString(cursor), 'runMigration() params.cursor must be null or a non-empty string');
    assertNonEmptyString(startedBy, 'runMigration() params.startedBy');
    assertNonEmptyString(now, 'runMigration() params.now');
    assert(!(dryRun && force), 'runMigration() params.force cannot be used with dryRun');
}

async function runDryBatch(context, migration, cursor) {
    let batchResult;
    try {
        batchResult = await migration.migrate(context, { cursor, dryRun: true });
    } catch (cause) {
        if (cause.name === 'InvalidCursorError' || isExpectedError(cause)) {
            throw cause;
        }
        throw new AssertionError('Unexpected error while running dry migration batch', { cause });
    }

    try {
        validateBatchResult(batchResult, cursor);
    } catch (cause) {
        throw new AssertionError('Migration returned an invalid dry-run batch result', { cause });
    }

    return {
        done: batchResult.done,
        cursor: batchResult.cursor,
        stats: batchResult.stats,
        status: 'dry-run',
        dryRun: true,
    };
}

async function prepareRealRun(context, migrationLedger, args) {
    const {
        id,
        force,
        startedBy,
        now,
    } = args;
    let existingRecord;

    try {
        existingRecord = await migrationLedger.getByMigrationId(context, id);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading migration ledger state', { cause });
    }

    const preparation = computeRunPreparation({
        existing: existingRecord ? getRecordState(existingRecord) : null,
        force,
        adminId: startedBy,
        now,
    });

    if (preparation.action === 'reject-applied') {
        throw new ConflictError('This migration has already been applied.', {
            code: 'MigrationAlreadyAppliedError',
        });
    }

    if (preparation.action === 'create') {
        return await createLedgerRecord(
            context,
            migrationLedger,
            id,
            preparation.seed,
        );
    }

    if (preparation.action === 'resume-failed') {
        existingRecord.merge(preparation.state);
    } else if (preparation.action === 'reset') {
        existingRecord.merge(preparation.seed);
    }

    return await updateLedgerRecord(
        context,
        migrationLedger,
        existingRecord,
        'preparing migration batch execution',
    );
}

async function createLedgerRecord(context, migrationLedger, id, seed) {
    try {
        return await migrationLedger.createLedgerRecord(context, id, seed);
    } catch (cause) {
        throwLedgerWriteError(cause, 'creating migration ledger state');
    }
}

async function updateLedgerRecord(context, migrationLedger, record, operation) {
    try {
        return await migrationLedger.updateLedgerRecord(context, record);
    } catch (cause) {
        throwLedgerWriteError(cause, operation);
    }
}

function throwLedgerWriteError(cause, operation) {
    if (cause.name === 'DocumentAlreadyExistsError' || cause.name === 'VersionConflictError') {
        throw new ConflictError('Another operator advanced this migration. Retry the request.', {
            cause,
            code: 'MigrationConcurrencyError',
        });
    }

    throw new AssertionError(`Unexpected error while ${ operation }`, { cause });
}

async function recordFailedRun(context, migrationLedger, record, cause, now) {
    try {
        const failedState = computeFailedState({
            base: getRecordState(record),
            errorMessage: getSafeFailureMessage(cause),
            now,
        });
        record.merge(failedState);
        await migrationLedger.updateLedgerRecord(context, record);
    } catch {
        // Failure bookkeeping is best-effort and must never replace the error
        // produced by the migration invocation or its result contract.
    }
}

function throwMigrationFailure(cause) {
    if (cause.name === 'InvalidCursorError') {
        throw new ConflictError('The stored migration cursor is invalid. Restart with force.', {
            cause,
            code: 'MigrationCursorConflictError',
        });
    }

    if (isExpectedError(cause)) {
        throw cause;
    }

    throw new AssertionError('Unexpected error while running migration batch', { cause });
}

function isExpectedError(error) {
    return error?.expected === true || error?.httpError === true;
}

function getSafeFailureMessage(error) {
    if (error?.name === 'InvalidCursorError') {
        return 'The stored migration cursor is invalid.';
    }

    if (isExpectedError(error) && isNonEmptyString(error.message)) {
        return error.message;
    }

    if (error?.name === 'InvalidMigrationBatchResultError') {
        return 'The migration returned an invalid batch result.';
    }

    return 'The migration batch failed.';
}

function getRecordState(record) {
    const state = {
        status: record.status,
        cursor: record.cursor,
        stats: record.stats,
        batchCount: record.batchCount,
        startedBy: record.startedBy,
        startedAt: record.startedAt,
        lastBatchAt: record.lastBatchAt,
        completedAt: record.completedAt,
        error: record.error,
    };

    assert(isPlainObject(state.stats), 'getRecordState() record.stats must be a plain object');
    return state;
}

function presentRealResult(record) {
    return {
        done: record.status === 'applied',
        cursor: record.cursor,
        stats: record.stats,
        status: record.status,
        dryRun: false,
    };
}
