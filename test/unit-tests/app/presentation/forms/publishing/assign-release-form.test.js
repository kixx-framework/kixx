import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import AssignReleaseForm from '../../../../../../src/app/presentation/forms/publishing/assign-release-form.js';


const VALID_HASH = 'a'.repeat(26);
const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000001';

function fieldErrors(attributes) {
    const form = new AssignReleaseForm(attributes);

    try {
        form.validate();
    } catch (error) {
        return error.errors.map((item) => item.source);
    }

    return [];
}

describe('AssignReleaseForm', ({ it }) => {

    it('trims Release and build fields while preserving the assignment token', () => {
        const form = new AssignReleaseForm({
            release_id: `  ${ VALID_HASH }  `,
            build_id: '  build-1  ',
            expected_assignment_id: ASSIGNMENT_ID,
        });

        assertEqual(VALID_HASH, form.release_id);
        assertEqual('build-1', form.build_id);
        assertEqual(ASSIGNMENT_ID, form.expected_assignment_id);
    });

    it('accepts a fully populated valid submission', () => {
        assertEqual(0, fieldErrors({
            release_id: VALID_HASH,
            build_id: 'build-1',
            expected_assignment_id: ASSIGNMENT_ID,
        }).length);
    });

    it('requires every field', () => {
        const errors = fieldErrors({});

        assert(errors.includes('release_id'));
        assert(errors.includes('build_id'));
        assert(errors.includes('expected_assignment_id'));
    });

    it('rejects hash tokens and whitespace instead of changing the opaque identity', () => {
        for (const expected_assignment_id of [ VALID_HASH, ` ${ ASSIGNMENT_ID } `, null, 1, {} ]) {
            assert(fieldErrors({
                release_id: VALID_HASH, build_id: 'build-1', expected_assignment_id,
            }).includes('expected_assignment_id'));
        }
    });

    it('rejects a release_id that is not a valid content hash', () => {
        const errors = fieldErrors({
            release_id: 'not-a-hash',
            build_id: 'build-1',
            expected_assignment_id: ASSIGNMENT_ID,
        });

        assert(errors.includes('release_id'));
    });

    it('rejects an expected_assignment_id that is not a valid UUID', () => {
        const errors = fieldErrors({
            release_id: VALID_HASH,
            build_id: 'build-1',
            expected_assignment_id: 'not-a-hash',
        });

        assert(errors.includes('expected_assignment_id'));
    });
});
