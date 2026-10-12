import { describe } from 'kixx-test';
import { assert } from 'kixx-assert';

import PublishingApiTokenCollection from '../../../../src/app/collections/publishing-api-token-collection.js';
import { ROLE_EDITOR } from '../../../../src/app/permissions/roles.js';


const ROLE_ASSERTION_MESSAGE =
    'PublishingApiTokenCollection#createToken() roles must be attachable publishing role ids';

const NON_EMPTY_ASSERTION_MESSAGE =
    'PublishingApiTokenCollection#createToken() roles must be a non-empty array';

// The role assertions run before any store access, so a stub document store is
// enough to exercise them. A submission that clears them reaches the store and
// fails there instead, which is what distinguishes the two outcomes below.
function createCollection() {
    return new PublishingApiTokenCollection({ db: {} });
}

async function createTokenError(roles) {
    try {
        await createCollection().createToken({}, {
            createdBy: 'admin-user-id',
            roles,
            ttlSeconds: 60,
        });
    } catch (error) {
        return error;
    }

    return null;
}

describe('PublishingApiTokenCollection#createToken() role validation', ({ it }) => {

    it('refuses role ids not attachable to a publishing token', async () => {
        for (const id of [ 'admin', 'developer', 'root-admin', 'not-a-role', 'Editor' ]) {
            const error = await createTokenError([ id ]);

            assert(error, `expected '${ id }' to be refused`);
            assert(
                error.message.startsWith(ROLE_ASSERTION_MESSAGE),
                `expected '${ id }' to be refused: ${ error.message }`,
            );
        }
    });

    it('refuses a missing or empty roles list', async () => {
        for (const roles of [ undefined, null, [], 'editor' ]) {
            const error = await createTokenError(roles);

            assert(error, 'expected an empty roles list to be refused');
            assert(
                error.message.startsWith(NON_EMPTY_ASSERTION_MESSAGE),
                `expected a non-empty array to be required: ${ error.message }`,
            );
        }
    });

    it('accepts the Editor role id', async () => {
        const error = await createTokenError([ ROLE_EDITOR ]);

        assert(error, 'expected the stub document store to fail after the role checks');
        assert(
            !error.message.startsWith(ROLE_ASSERTION_MESSAGE),
            'expected the Editor role id to clear the role checks',
        );
    });

});
