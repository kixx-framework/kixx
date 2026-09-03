import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import AssignReleaseForm from '../../../../../../src/app/presentation/forms/publishing/assign-release-form.js';


const VALID_HASH = 'a'.repeat(26);
const OTHER_VALID_HASH = 'b'.repeat(26);

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

    it('trims submitted string fields', () => {
        const form = new AssignReleaseForm({
            release_id: `  ${ VALID_HASH }  `,
            build_id: '  build-1  ',
            expected_release_id: `  ${ OTHER_VALID_HASH }  `,
        });

        assertEqual(VALID_HASH, form.release_id);
        assertEqual('build-1', form.build_id);
        assertEqual(OTHER_VALID_HASH, form.expected_release_id);
    });

    it('accepts a fully populated valid submission', () => {
        assertEqual(0, fieldErrors({
            release_id: VALID_HASH,
            build_id: 'build-1',
            expected_release_id: OTHER_VALID_HASH,
        }).length);
    });

    it('requires every field', () => {
        const errors = fieldErrors({});

        assert(errors.includes('release_id'));
        assert(errors.includes('build_id'));
        assert(errors.includes('expected_release_id'));
    });

    it('rejects a release_id that is not a valid content hash', () => {
        const errors = fieldErrors({
            release_id: 'not-a-hash',
            build_id: 'build-1',
            expected_release_id: OTHER_VALID_HASH,
        });

        assert(errors.includes('release_id'));
    });

    it('rejects an expected_release_id that is not a valid content hash', () => {
        const errors = fieldErrors({
            release_id: VALID_HASH,
            build_id: 'build-1',
            expected_release_id: 'not-a-hash',
        });

        assert(errors.includes('expected_release_id'));
    });
});
