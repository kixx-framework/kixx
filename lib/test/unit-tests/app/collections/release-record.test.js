import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ReleaseRecord from '../../../../src/app/collections/release-record.js';


function makeRecord(overrides) {
    return ReleaseRecord.forWrite({
        type: 'Release',
        id: 'release-1',
        attributes: Object.assign({
            releaseId: 'release-1',
            createdAt: '2026-09-01T12:00:00.000Z',
            createdBy: 'token-1',
            objectCount: 2,
            totalBytes: 42,
            contractVersion: 1,
            provenance: {},
        }, overrides),
    });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('ReleaseRecord', ({ it }) => {

    it('accepts known provenance fields', () => {
        const record = makeRecord({
            provenance: {
                sourceRevision: 'abc123',
                message: 'Publish home page',
                client: 'kixx-cli/1',
                intendedForBuildId: 'build-2',
            },
        });

        assertEqual(undefined, record.validate());
    });

    it('reports every unknown provenance field', () => {
        const error = catchError(() => makeRecord({
            provenance: { branch: 'main', environment: 'production' },
        }).validate());

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual(2, error.errors.length);
        assertEqual('provenance.branch', error.errors[0].source);
        assertEqual('provenance.environment', error.errors[1].source);
    });
});
