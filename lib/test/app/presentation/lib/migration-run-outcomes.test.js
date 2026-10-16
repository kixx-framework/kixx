import { describe } from 'kixx-test';
import { assert, assertEqual, assertNonEmptyString } from 'kixx-assert';

import {
    MIGRATION_NOTICES,
    LIST_NOTICE_CODES,
    DETAIL_NOTICE_CODES,
    getMigrationNotice,
    classifyMigrationRunError,
    getUnexpectedRunCode,
    recoverUnexpectedRunError,
    getMigrationOutcomeStatus,
} from '../../../../app/presentation/lib/migration-run-outcomes.js';
import { INVALID_CSRF_TOKEN_CODE } from '../../../../app/presentation/lib/csrf.js';
import {
    AssertionError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
} from '../../../../kixx/errors/mod.js';


const ROLE_FOR_TONE = {
    info: 'status',
    success: 'status',
    warning: 'alert',
    error: 'alert',
};

function makeInvalidCursorError() {
    const error = new Error('Unknown cursor');
    error.name = 'InvalidCursorError';
    return error;
}

function makeLogger() {
    const calls = [];
    const record = (level) => (...args) => calls.push({ level, args });
    return {
        calls,
        error: record('error'),
        warn: record('warn'),
        info: record('info'),
        debug: record('debug'),
    };
}


describe('migration run outcomes', ({ describe }) => {

    describe('MIGRATION_NOTICES', ({ it }) => {
        it('gives every notice a valid tone, matching role, and text', () => {
            const codes = Object.keys(MIGRATION_NOTICES);
            assertEqual(16, codes.length);

            for (const code of codes) {
                const notice = MIGRATION_NOTICES[code];
                assertEqual(code, notice.code);
                assert(Object.hasOwn(ROLE_FOR_TONE, notice.tone), `${ code } tone`);
                assertEqual(ROLE_FOR_TONE[notice.tone], notice.role, `${ code } role`);
                assertNonEmptyString(notice.title);
                assertNonEmptyString(notice.message);
                assert(Object.isFrozen(notice), `${ code } frozen`);
            }

            assert(Object.isFrozen(MIGRATION_NOTICES));
        });

        it('keeps the unexpected notices free of placeholders', () => {
            for (const code of [ 'batch_failed_unexpected', 'dry_run_failed_unexpected' ]) {
                const { title, message } = MIGRATION_NOTICES[code];
                assert(!/[{}$<>]/.test(title + message), `${ code } has a placeholder`);
            }
        });

        it('allow-lists unexpected codes only on the detail page', () => {
            assert(DETAIL_NOTICE_CODES.includes('batch_failed_unexpected'));
            assert(!DETAIL_NOTICE_CODES.includes('dry_run_failed_unexpected'));
            assert(!LIST_NOTICE_CODES.includes('dry_run_failed_unexpected'));
            assertEqual(1, LIST_NOTICE_CODES.length);
            assertEqual('migration_not_found', LIST_NOTICE_CODES[0]);

            for (const code of DETAIL_NOTICE_CODES) {
                assert(Object.hasOwn(MIGRATION_NOTICES, code), `${ code } is defined`);
                assert(!code.startsWith('dry_run_'), `${ code } is not a dry-run code`);
            }
        });
    });

    describe('getMigrationNotice', ({ it }) => {
        it('returns the notice for an allowed code', () => {
            assertEqual(MIGRATION_NOTICES.migration_not_found, getMigrationNotice('migration_not_found', LIST_NOTICE_CODES));
            assertEqual(MIGRATION_NOTICES.applied, getMigrationNotice('applied', DETAIL_NOTICE_CODES));
        });

        it('returns null for a known code outside the allow-list', () => {
            assertEqual(null, getMigrationNotice('already_applied', LIST_NOTICE_CODES));
            assertEqual(null, getMigrationNotice('migration_not_found', DETAIL_NOTICE_CODES));
            assertEqual(null, getMigrationNotice('dry_run_done', DETAIL_NOTICE_CODES));
        });

        it('returns null for unknown codes and non-strings', () => {
            assertEqual(null, getMigrationNotice('nope', DETAIL_NOTICE_CODES));
            assertEqual(null, getMigrationNotice('<script>', DETAIL_NOTICE_CODES));
            assertEqual(null, getMigrationNotice('__proto__', DETAIL_NOTICE_CODES));
            assertEqual(null, getMigrationNotice(undefined, DETAIL_NOTICE_CODES));
            assertEqual(null, getMigrationNotice(null, DETAIL_NOTICE_CODES));
            assertEqual(null, getMigrationNotice([ 'applied' ], DETAIL_NOTICE_CODES));
        });
    });

    describe('classifyMigrationRunError', ({ it }) => {
        it('maps an invalid CSRF token to form_expired', () => {
            const error = new ForbiddenError('Invalid token', { code: INVALID_CSRF_TOKEN_CODE, expected: true });
            assertEqual('form_expired', classifyMigrationRunError(error, { dryRun: false }));
            assertEqual('form_expired', classifyMigrationRunError(error, { dryRun: true }));
        });

        it('maps NotFoundError to migration_not_found', () => {
            const error = new NotFoundError('Migration "x" is not registered');
            assertEqual('migration_not_found', classifyMigrationRunError(error, { dryRun: false }));
            assertEqual('migration_not_found', classifyMigrationRunError(error, { dryRun: true }));
        });

        it('maps the runMigration conflict codes', () => {
            const applied = new ConflictError('applied', { code: 'MigrationAlreadyAppliedError' });
            const concurrent = new ConflictError('concurrent', { code: 'MigrationConcurrencyError' });
            const cursor = new ConflictError('cursor', { code: 'MigrationCursorConflictError' });

            assertEqual('already_applied', classifyMigrationRunError(applied, { dryRun: false }));
            assertEqual('concurrent_run', classifyMigrationRunError(concurrent, { dryRun: false }));
            assertEqual('cursor_conflict', classifyMigrationRunError(cursor, { dryRun: false }));
        });

        it('maps a dry-run InvalidCursorError to dry_run_cursor_invalid', () => {
            assertEqual('dry_run_cursor_invalid', classifyMigrationRunError(makeInvalidCursorError(), { dryRun: true }));
        });

        it('maps other expected errors to the failed codes', () => {
            const conflict = new ConflictError('Example failure');
            const validation = new ValidationError('Bad data');

            assertEqual('batch_failed', classifyMigrationRunError(conflict, { dryRun: false }));
            assertEqual('dry_run_failed', classifyMigrationRunError(conflict, { dryRun: true }));
            assertEqual('dry_run_failed', classifyMigrationRunError(validation, { dryRun: true }));
            assertEqual('batch_failed', classifyMigrationRunError({ name: 'Custom', expected: true }, { dryRun: false }));
        });

        it('returns null for unexpected errors', () => {
            const assertion = new AssertionError('bug', { cause: new Error('root') });

            assertEqual(null, classifyMigrationRunError(assertion, { dryRun: false }));
            assertEqual(null, classifyMigrationRunError(assertion, { dryRun: true }));
            assertEqual(null, classifyMigrationRunError(new Error('x'), { dryRun: false }));
            assertEqual(null, classifyMigrationRunError(makeInvalidCursorError(), { dryRun: false }));
            assertEqual(null, classifyMigrationRunError(undefined, { dryRun: false }));
            assertEqual(null, classifyMigrationRunError({ name: 'Custom', expected: false }, { dryRun: true }));
        });
    });

    describe('getUnexpectedRunCode', ({ it }) => {
        it('returns the code for the run mode', () => {
            assertEqual('batch_failed_unexpected', getUnexpectedRunCode({ dryRun: false }));
            assertEqual('dry_run_failed_unexpected', getUnexpectedRunCode({ dryRun: true }));
        });
    });

    describe('recoverUnexpectedRunError', ({ it }) => {
        function makeContext() {
            return { requestId: 'req-1', logger: makeLogger() };
        }

        it('logs once at error level and returns the real-run code', () => {
            const context = makeContext();
            const cause = new Error('storage offline');
            const error = new AssertionError('Unexpected error while running migration batch', { cause });

            const code = recoverUnexpectedRunError(context, error, { id: 'm-1', dryRun: false, force: true });

            assertEqual('batch_failed_unexpected', code);
            assertEqual(1, context.logger.calls.length);

            const [ call ] = context.logger.calls;
            assertEqual('error', call.level);
            assertEqual('unexpected error while running migration batch from admin panel', call.args[0]);
            assertEqual('req-1', call.args[1].requestId);
            assertEqual('m-1', call.args[1].migrationId);
            assertEqual(false, call.args[1].dryRun);
            assertEqual(true, call.args[1].force);
            assertEqual(error, call.args[2]);
            assertEqual(cause, call.args[2].cause);
        });

        it('returns the dry-run code for a dry run', () => {
            const context = makeContext();
            const error = new AssertionError('Unexpected error while running dry migration batch', { cause: new Error('x') });

            const code = recoverUnexpectedRunError(context, error, { id: 'm-1', dryRun: true, force: false });

            assertEqual('dry_run_failed_unexpected', code);
            assertEqual(1, context.logger.calls.length);
            assertEqual(true, context.logger.calls[0].args[1].dryRun);
            assertEqual(false, context.logger.calls[0].args[1].force);
        });
    });

    describe('getMigrationOutcomeStatus', ({ it }) => {
        it('returns the fixed statuses', () => {
            assertEqual(400, getMigrationOutcomeStatus('dry_run_cursor_invalid', makeInvalidCursorError()));
            assertEqual(403, getMigrationOutcomeStatus('form_expired', new ForbiddenError('x')));
            assertEqual(404, getMigrationOutcomeStatus('migration_not_found', new NotFoundError('x')));
        });

        it('returns 500 for unexpected codes whatever the error carries', () => {
            const error = new ConflictError('x');
            assertEqual(500, getMigrationOutcomeStatus('batch_failed_unexpected', error));
            assertEqual(500, getMigrationOutcomeStatus('dry_run_failed_unexpected', error));
        });

        it('uses the error status otherwise, falling back to 500', () => {
            assertEqual(409, getMigrationOutcomeStatus('already_applied', new ConflictError('x')));
            assertEqual(422, getMigrationOutcomeStatus('dry_run_failed', new ValidationError('x')));
            assertEqual(500, getMigrationOutcomeStatus('batch_failed', { expected: true }));
            assertEqual(500, getMigrationOutcomeStatus('batch_failed'));
        });
    });
});
