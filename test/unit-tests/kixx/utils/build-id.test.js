import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    isValidBuildId,
    validateBuildId,
} from '../../../../src/kixx/utils/build-id.js';


describe('Build ID utilities', ({ it }) => {
    it('accepts safe case-preserving single-segment Build IDs', () => {
        for (const buildId of [ 'Build-2026_07', 'release.1', 'a.b-c_d' ]) {
            assertEqual(true, isValidBuildId(buildId));
            assertEqual(buildId, validateBuildId(buildId));
        }
    });

    it('rejects empty, non-string, and unsafe Build IDs', () => {
        for (const buildId of [ undefined, null, '', 42, 'build/child', 'bad id', 'bad@id', '.hidden', '..' ]) {
            assertEqual(false, isValidBuildId(buildId));

            const caught = catchError(() => validateBuildId(buildId));
            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual('InvalidBuildId', caught.code);
        }
    });

    it('accepts a Build ID formerly reserved by the static file store', () => {
        assertEqual(true, isValidBuildId('dev'));
        assertEqual('dev', validateBuildId('dev'));
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
