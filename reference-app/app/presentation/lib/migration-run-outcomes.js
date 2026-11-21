import { INVALID_CSRF_TOKEN_CODE } from './csrf.js';


const ROLE_FOR_TONE = {
    info: 'status',
    success: 'status',
    warning: 'alert',
    error: 'alert',
};


function defineNotice(code, tone, title, message) {
    return Object.freeze({ code, tone, role: ROLE_FOR_TONE[tone], title, message });
}


/**
 * Operator-facing migration notices keyed by code. The text is static and
 * never interpolates request data or error details, so the same objects can
 * be rendered by templates and sent in JSON responses.
 * @type {Readonly<Object<string, Readonly<{code: string, tone: string, role: string, title: string, message: string}>>>}
 */
export const MIGRATION_NOTICES = Object.freeze({
    batch_complete: defineNotice(
        'batch_complete',
        'info',
        'Batch complete',
        'One batch was committed. Run again to continue from the saved position.',
    ),
    applied: defineNotice(
        'applied',
        'success',
        'Migration applied',
        'The final batch was committed and the migration is applied.',
    ),
    force_started: defineNotice(
        'force_started',
        'info',
        'Fresh run started',
        'The ledger record was reset and the first batch of a fresh run was committed. Run again to continue.',
    ),
    force_unavailable: defineNotice(
        'force_unavailable',
        'info',
        'Force re-run not available',
        'Force re-run only applies to applied or failed migrations.',
    ),
    already_applied: defineNotice(
        'already_applied',
        'warning',
        'Already applied',
        'This migration has already been applied. Use Force re-run to start it again.',
    ),
    concurrent_run: defineNotice(
        'concurrent_run',
        'warning',
        'Changed by another request',
        'Another request changed this migration at the same time. Review the status before running again.',
    ),
    cursor_conflict: defineNotice(
        'cursor_conflict',
        'error',
        'Stored cursor rejected',
        'The migration rejected its stored cursor and is marked failed. Use Force re-run to restart it.',
    ),
    batch_failed: defineNotice(
        'batch_failed',
        'error',
        'Batch failed',
        'The batch did not commit. The ledger error is shown below. Run retries from the last committed batch.',
    ),
    form_expired: defineNotice(
        'form_expired',
        'warning',
        'Page expired',
        'Nothing ran because this page expired. Reload the page and try again.',
    ),
    migration_not_found: defineNotice(
        'migration_not_found',
        'error',
        'Migration not found',
        'No migration with that id is registered in this build.',
    ),
    dry_run_batch: defineNotice(
        'dry_run_batch',
        'info',
        'Dry-run batch complete',
        'Nothing was written. Dry run the next batch to continue.',
    ),
    dry_run_done: defineNotice(
        'dry_run_done',
        'success',
        'Dry run complete',
        'The dry run reached the end of the migration. Nothing was written.',
    ),
    dry_run_cursor_invalid: defineNotice(
        'dry_run_cursor_invalid',
        'error',
        'Dry-run cursor rejected',
        'The dry-run cursor was rejected. Start the dry run again from the beginning.',
    ),
    dry_run_failed: defineNotice(
        'dry_run_failed',
        'error',
        'Dry-run batch failed',
        'The dry-run batch failed. Nothing was written.',
    ),
    batch_failed_unexpected: defineNotice(
        'batch_failed_unexpected',
        'error',
        'Batch failed unexpectedly',
        'The batch failed with an unexpected error, which was logged. The ledger was marked failed if it could be updated. Review the status below before running again.',
    ),
    dry_run_failed_unexpected: defineNotice(
        'dry_run_failed_unexpected',
        'error',
        'Dry-run batch failed unexpectedly',
        'The dry-run batch failed with an unexpected error, which was logged. Nothing was written.',
    ),
});

/**
 * Notice codes the migration list page accepts from its `?notice=` parameter.
 * @type {ReadonlyArray<string>}
 */
export const LIST_NOTICE_CODES = Object.freeze([
    'migration_not_found',
]);

/**
 * Notice codes the migration detail page accepts from its `?notice=` parameter.
 * Dry-run codes are absent because dry runs render their result directly.
 * @type {ReadonlyArray<string>}
 */
export const DETAIL_NOTICE_CODES = Object.freeze([
    'batch_complete',
    'applied',
    'force_started',
    'force_unavailable',
    'already_applied',
    'concurrent_run',
    'cursor_conflict',
    'batch_failed',
    'batch_failed_unexpected',
    'form_expired',
]);

/**
 * Resolves an untrusted notice code against a page's allow-list.
 * @param {*} code - Raw notice code, usually from the query string.
 * @param {ReadonlyArray<string>} allowedCodes - Codes the page accepts.
 * @returns {Object|null} The notice, or null for an unknown, disallowed, or non-string code.
 */
export function getMigrationNotice(code, allowedCodes) {
    if (typeof code !== 'string' || !allowedCodes.includes(code)) {
        return null;
    }

    return Object.hasOwn(MIGRATION_NOTICES, code) ? MIGRATION_NOTICES[code] : null;
}

/**
 * Maps an expected error caught around a migration run (or its CSRF check)
 * to a notice code.
 * @param {*} error - Caught error.
 * @param {{dryRun: boolean}} options - Whether the caught error came from a dry run.
 * @returns {string|null} Notice code, or null when the error is unexpected.
 */
export function classifyMigrationRunError(error, { dryRun }) {
    if (!error) {
        return null;
    }

    if (error.code === INVALID_CSRF_TOKEN_CODE) {
        return 'form_expired';
    }

    if (error.name === 'NotFoundError') {
        return 'migration_not_found';
    }

    if (error.code === 'MigrationAlreadyAppliedError') {
        return 'already_applied';
    }

    if (error.code === 'MigrationConcurrencyError') {
        return 'concurrent_run';
    }

    if (error.code === 'MigrationCursorConflictError') {
        return 'cursor_conflict';
    }

    // A real run converts InvalidCursorError into a cursor conflict, so one
    // escaping a real run is a bug and stays unclassified.
    if (dryRun && error.name === 'InvalidCursorError') {
        return 'dry_run_cursor_invalid';
    }

    if (error.expected === true) {
        return dryRun ? 'dry_run_failed' : 'batch_failed';
    }

    return null;
}

/**
 * Picks the notice code for an unexpected runMigration failure.
 * @param {{dryRun: boolean}} options - Whether the failure came from a dry run.
 * @returns {string} `dry_run_failed_unexpected` or `batch_failed_unexpected`.
 */
export function getUnexpectedRunCode({ dryRun }) {
    return dryRun ? 'dry_run_failed_unexpected' : 'batch_failed_unexpected';
}

/**
 * Logs an unexpected runMigration failure and returns its fixed notice code.
 *
 * This implements the sanctioned exception in `lib/docs/server-error-handling.md`.
 * Call it only for an error thrown by the `runMigration` call in the admin
 * panel's Run, Dry run, and Force handlers, after classifyMigrationRunError()
 * returned null. It never rethrows, and the returned code carries no error detail.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Error} error - The unclassified error thrown by runMigration.
 * @param {{id: string, dryRun: boolean, force: boolean}} run - The attempted run.
 * @returns {string} `dry_run_failed_unexpected` or `batch_failed_unexpected`.
 */
export function recoverUnexpectedRunError(context, error, { id, dryRun, force }) {
    context.logger.error(
        'unexpected error while running migration batch from admin panel',
        { requestId: context.requestId, migrationId: id, dryRun, force },
        error,
    );

    return getUnexpectedRunCode({ dryRun });
}

/**
 * Picks the HTTP status for a migration run outcome rendered in place.
 * @param {string} code - Notice code.
 * @param {*} [error] - The caught error, when there is one.
 * @returns {number} HTTP status code.
 */
export function getMigrationOutcomeStatus(code, error) {
    switch (code) {
        case 'dry_run_cursor_invalid':
            return 400;
        case 'form_expired':
            return 403;
        case 'migration_not_found':
            return 404;
        case 'batch_failed_unexpected':
        case 'dry_run_failed_unexpected':
            return 500;
        default:
            return (error && error.httpStatusCode) || 500;
    }
}
