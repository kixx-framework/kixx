import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { isValidAssignmentId } from '../../../../src/kixx/content-addressable-store/build-assignment.js';

describe('Assignment identity', ({ it }) => {
    it('accepts server UUIDs and rejects content hashes and malformed identities', () => {
        assertEqual(true, isValidAssignmentId(crypto.randomUUID()));
        for (const value of [ null, undefined, 42, {}, '', 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
            '00000000-0000-1000-8000-000000000001', '00000000-0000-4000-0000-000000000001' ]) {
            assertEqual(false, isValidAssignmentId(value));
        }
    });
});
