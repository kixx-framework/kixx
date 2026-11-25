import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    BUILD_ASSIGNMENT_OUTCOME,
    RELEASE_RECORD_OUTCOME,
} from '../../../kixx/content-addressable-store/content-store-interface.js';


describe('content store outcome constants', ({ it }) => {
    it('keeps the four assignment outcomes and adds the code mismatch', () => {
        assert(Object.isFrozen(BUILD_ASSIGNMENT_OUTCOME));
        assertEqual(
            JSON.stringify({
                ASSIGNED: 'assigned',
                UNCHANGED: 'unchanged',
                CONFLICT: 'conflict',
                MISSING_CLOSURE: 'missingClosure',
                CODE_MISMATCH: 'codeMismatch',
            }),
            JSON.stringify(BUILD_ASSIGNMENT_OUTCOME),
        );
    });

    it('holds the three Release record outcomes', () => {
        assert(Object.isFrozen(RELEASE_RECORD_OUTCOME));
        assertEqual(
            JSON.stringify({ CREATED: 'created', EXISTS: 'exists', MISSING_CLOSURE: 'missingClosure' }),
            JSON.stringify(RELEASE_RECORD_OUTCOME),
        );
    });
});
