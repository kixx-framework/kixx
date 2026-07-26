import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import RunMigrationForm from '../../../../../src/app/presentation/forms/migrations/run-migration-form.js';


describe('RunMigrationForm', ({ it }) => {
    it('defaults omitted migration run attributes', () => {
        const form = RunMigrationForm.fromJsonApi({ attributes: {} });
        const values = form.toJSON();

        assertEqual(false, values.dryRun);
        assertEqual(false, values.force);
        assertEqual(null, values.cursor);
    });

    it('returns valid normalized migration run attributes', () => {
        const form = RunMigrationForm.fromJsonApi({
            attributes: {
                dryRun: true,
                force: false,
                cursor: 'opaque-cursor',
            },
        });

        form.validate();
        const values = form.toJSON();

        assertEqual(true, values.dryRun);
        assertEqual(false, values.force);
        assertEqual('opaque-cursor', values.cursor);
    });

    it('rejects non-boolean dryRun and force values with field errors', () => {
        const form = new RunMigrationForm({
            dryRun: 'true',
            force: null,
        });
        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'dryRun', 'force' ]);
    });

    it('rejects cursor values other than null or a non-empty string', () => {
        for (const cursor of [ '', 42, false ]) {
            const form = new RunMigrationForm({ cursor });
            const caught = catchError(() => form.validate());

            assertValidationSources(caught, [ 'cursor' ]);
        }
    });

    it('rejects dryRun and force when both are true', () => {
        const form = new RunMigrationForm({
            dryRun: true,
            force: true,
        });
        const caught = catchError(() => form.validate());

        assertValidationSources(caught, [ 'force' ]);
    });
});

function assertValidationSources(error, expectedSources) {
    assert(error, 'expected a ValidationError');
    assertEqual('ValidationError', error.name);
    assertEqual(expectedSources.join(','), error.errors.map(({ source }) => source).join(','));
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
