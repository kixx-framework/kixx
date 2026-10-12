import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import CreatePublishingApiTokenForm, {
    DEFAULT_PUBLISHING_API_TOKEN_ROLE,
} from '../../../../../../src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js';
import { ROLE_EDITOR } from '../../../../../../src/app/permissions/roles.js';


function roleFieldErrors(roles) {
    const form = new CreatePublishingApiTokenForm({ roles });

    try {
        form.validate();
    } catch (error) {
        return error.errors.filter((item) => item.source === 'roles');
    }

    return [];
}

describe('CreatePublishingApiTokenForm role validation', ({ it }) => {

    it('defaults an omitted or empty roles list to the Editor id', () => {
        assertEqual(ROLE_EDITOR, DEFAULT_PUBLISHING_API_TOKEN_ROLE);

        for (const roles of [ undefined, null, [] ]) {
            const form = new CreatePublishingApiTokenForm({ roles });

            assertEqual(1, form.roles.length);
            assertEqual(ROLE_EDITOR, form.roles[0]);
        }
    });

    it('accepts the Editor role id', () => {
        assertEqual(0, roleFieldErrors([ ROLE_EDITOR ]).length);
    });

    // Admin-category ids and the unattachable root-admin id are registered
    // roles, so only the category check keeps them off a publishing token.
    it('refuses role ids outside the editor category', () => {
        for (const id of [ 'admin', 'developer', 'root-admin', 'not-a-role', 'Editor' ]) {
            assertEqual(1, roleFieldErrors([ id ]).length, `expected '${ id }' to be refused`);
        }
    });

    it('refuses a list mixing the Editor id with a forbidden id', () => {
        assertEqual(1, roleFieldErrors([ ROLE_EDITOR, 'developer' ]).length);
    });

    // A non-array submission is normalized to the default rather than
    // refused. That defaults to the least capable publishing role, so a
    // forged 'roles' value cannot widen the minted token.
    it('normalizes a non-array roles submission to the Editor id', () => {
        const form = new CreatePublishingApiTokenForm({ roles: 'developer' });

        assertEqual(1, form.roles.length);
        assertEqual(ROLE_EDITOR, form.roles[0]);
    });

});
