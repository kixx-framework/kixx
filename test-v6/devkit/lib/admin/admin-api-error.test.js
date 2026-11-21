import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import AdminApiError, {
    MigrationAlreadyAppliedError,
    MigrationCursorConflictError,
    MigrationConcurrencyError,
    InvalidCredentialsError,
    InvalidInviteError,
    NewUserConflictError,
    InviteSpentInEmailRaceError,
    createAdminApiError,
} from '../../../lib/admin/admin-api-error.js';

describe('admin/admin-api-error', ({ it }) => {
    it('maps each known code to its dedicated error class', () => {
        const cases = [
            [ 'MigrationAlreadyAppliedError', MigrationAlreadyAppliedError ],
            [ 'MigrationCursorConflictError', MigrationCursorConflictError ],
            [ 'MigrationConcurrencyError', MigrationConcurrencyError ],
            [ 'InvalidCredentials', InvalidCredentialsError ],
            [ 'InvalidInvite', InvalidInviteError ],
            [ 'NewUserConflictError', NewUserConflictError ],
            [ 'InviteSpentInEmailRace', InviteSpentInEmailRaceError ],
        ];

        for (const [ code, ErrorClass ] of cases) {
            const error = createAdminApiError('failed', {
                status: 409,
                errors: [ { code } ],
                method: 'POST',
                url: 'https://admin.example.test/admin-api/v1/migrations/x/run',
                attempts: 1,
            });

            assertEqual(true, error instanceof ErrorClass);
            assertEqual(ErrorClass.name, error.name);
            assertEqual(ErrorClass.name, error.code);
        }
    });

    it('falls back to the base error class for an unmapped code', () => {
        const error = createAdminApiError('failed', {
            status: 422,
            errors: [ { code: 'VALIDATION_ERROR' } ],
            method: 'POST',
            url: 'https://admin.example.test/admin-api/v1/migrations/x/run',
            attempts: 1,
        });

        assertEqual(true, error instanceof AdminApiError);
        assertEqual('AdminApiError', error.name);
    });

    it('renders the response errors verbatim on the base error', () => {
        const errors = [ { status: '422', code: 'VALIDATION_ERROR', detail: 'bad' } ];
        const error = createAdminApiError('failed', {
            status: 422,
            errors,
            method: 'POST',
            url: 'https://admin.example.test/admin-api/v1/migrations/x/run',
            attempts: 1,
        });

        assertEqual(JSON.stringify(errors), JSON.stringify(error.errors));
    });
});
