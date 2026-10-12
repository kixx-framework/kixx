import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ActivationRecord from '../../../../src/app/collections/activation-record.js';


const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';


function makeRecord(reason, overrides) {
    return ActivationRecord.forWrite({
        type: 'Activation',
        id: `build-1:${ ASSIGNMENT_ID }`,
        attributes: Object.assign({
            buildId: 'build-1',
            assignmentId: ASSIGNMENT_ID,
            fromReleaseId: null,
            toReleaseId: 'release-1',
            activatedAt: '2026-09-01T12:00:00.000Z',
            activatedBy: 'token-1',
            reason,
            buildActivationKey: 'build-1:2026-09-01T12:00:00.000Z',
        }, overrides),
    });
}

describe('ActivationRecord', ({ it }) => {

    it('accepts every audit reason', () => {
        for (const reason of [ 'publish', 'rollback', 'carry-forward', 'restore' ]) {
            assertEqual(undefined, makeRecord(reason).validate());
        }
    });

    it('rejects a missing assignmentId', () => {
        let error;
        try {
            makeRecord('publish', { assignmentId: undefined }).validate();
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('assignmentId', error.errors[0].source);
    });

    it('rejects an assignmentId which is not an assignment UUID', () => {
        let error;
        try {
            makeRecord('publish', { assignmentId: 'release-1' }).validate();
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('assignmentId', error.errors[0].source);
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
