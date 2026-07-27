import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import PublishingApiTokenRecord from '../../../../src/app/collections/publishing-api-token-record.js';


const REFERENCE_DATE = new Date('2026-07-27T12:00:00.000Z');


describe('PublishingApiTokenRecord', ({ it }) => {
    it('allows only an active token to be revoked', () => {
        assertEqual(true, makeRecord().isRevocable(REFERENCE_DATE));
        assertEqual(
            false,
            makeRecord({ tokenExpirationDate: REFERENCE_DATE.toISOString() }).isRevocable(REFERENCE_DATE),
        );
        assertEqual(
            false,
            makeRecord({ revokedAt: '2026-07-27T11:00:00.000Z' }).isRevocable(REFERENCE_DATE),
        );
        assertEqual(
            false,
            makeRecord({ tokenExpirationDate: 'not-a-date' }).isRevocable(REFERENCE_DATE),
        );
    });
});

function makeRecord(overrides) {
    return PublishingApiTokenRecord.forWrite({
        type: 'PublishingApiToken',
        id: 'stored-token-hash',
        attributes: {
            roles: [],
            description: null,
            createdBy: 'admin-1',
            tokenCreationDate: '2026-07-27T11:00:00.000Z',
            tokenExpirationDate: '2026-07-27T13:00:00.000Z',
            revokedAt: null,
            ...overrides,
        },
    });
}
