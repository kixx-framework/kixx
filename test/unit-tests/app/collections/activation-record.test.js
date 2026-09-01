import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ActivationRecord from '../../../../src/app/collections/activation-record.js';


function makeRecord(reason) {
    return ActivationRecord.forWrite({
        type: 'Activation',
        id: 'activation-1',
        attributes: {
            buildId: 'build-1',
            fromReleaseId: null,
            toReleaseId: 'release-1',
            activatedAt: '2026-09-01T12:00:00.000Z',
            activatedBy: 'token-1',
            reason,
            buildActivationKey: 'build-1:2026-09-01T12:00:00.000Z',
        },
    });
}

describe('ActivationRecord', ({ it }) => {

    it('accepts every audit reason', () => {
        for (const reason of [ 'publish', 'rollback', 'carry-forward', 'restore' ]) {
            assertEqual(undefined, makeRecord(reason).validate());
        }
    });

    it('rejects an unknown audit reason', () => {
        let error;
        try {
            makeRecord('deploy').validate();
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('reason', error.errors[0].source);
    });
});
