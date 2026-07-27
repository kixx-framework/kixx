import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import UserSessionRecord from '../../../../src/app/collections/user-session-record.js';


const CREATION_DATE = '2026-07-27T12:00:00.000Z';
const EXPIRATION_DATE = '2026-07-27T13:00:00.000Z';


describe('UserSessionRecord', ({ it }) => {
    it('expires at the embedded expiration timestamp', () => {
        const record = makeRecord();

        assertEqual(false, record.isExpired(new Date('2026-07-27T12:59:59.999Z')));
        assertEqual(true, record.isExpired(new Date(EXPIRATION_DATE)));
    });

    it('treats a malformed expiration timestamp as expired', () => {
        const record = makeRecord({ sessionExpirationDate: 'not-a-date' });

        assert(record.isExpired(new Date(CREATION_DATE)));
    });
});

function makeRecord(overrides) {
    return UserSessionRecord.forWrite({
        type: 'UserSession',
        id: 'session-1',
        attributes: {
            userId: 'admin-1',
            sessionCreationDate: CREATION_DATE,
            sessionExpirationDate: EXPIRATION_DATE,
            ...overrides,
        },
    });
}
