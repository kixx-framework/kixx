import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { deriveRolePermissions, ROLE_ROOT_ADMIN, ROLE_EDITOR } from '../../../../src/app/permissions/roles.js';
import { evaluatePermissions } from '../../../../src/kixx/permissions/permission-validation.js';


const BUILD_RESOURCE = 'urn:kixx:publishing:builds';

function isAuthorized(roleId, action, resource) {
    const permissions = deriveRolePermissions([ roleId ]);
    return evaluatePermissions(permissions, { action, resource });
}


describe('app/permissions/roles', ({ describe }) => {

    describe('Build resource grants', ({ it }) => {
        it('authorizes get and update on the Build resource for publishing-capable roles', () => {
            for (const roleId of [ 'developer', 'admin', ROLE_EDITOR ]) {
                assertEqual(true, isAuthorized(roleId, 'urn:kixx:get', BUILD_RESOURCE), `${ roleId } get`);
                assertEqual(true, isAuthorized(roleId, 'urn:kixx:update', BUILD_RESOURCE), `${ roleId } update`);
            }
        });

        it('authorizes Root Admin through its global wildcard', () => {
            assertEqual(true, isAuthorized(ROLE_ROOT_ADMIN, 'urn:kixx:get', BUILD_RESOURCE));
            assertEqual(true, isAuthorized(ROLE_ROOT_ADMIN, 'urn:kixx:update', BUILD_RESOURCE));
        });

        it('does not authorize an unrelated role or an unknown role id', () => {
            assertEqual(false, isAuthorized('unknown-role', 'urn:kixx:get', BUILD_RESOURCE));
            assertEqual(false, isAuthorized('unknown-role', 'urn:kixx:update', BUILD_RESOURCE));
        });

        it('does not extend the Editor role wildcard grant to update actions on other publishing resources', () => {
            // Editor's `urn:kixx:publishing:*` grant only lists get/create
            // actions; the Build resource's update grant must not broaden it.
            assertEqual(false, isAuthorized(ROLE_EDITOR, 'urn:kixx:update', 'urn:kixx:publishing:releases'));
            assertEqual(false, isAuthorized(ROLE_EDITOR, 'urn:kixx:delete', BUILD_RESOURCE));
        });

        it('still authorizes Editor for get/create on the rest of the publishing domain', () => {
            assertEqual(true, isAuthorized(ROLE_EDITOR, 'urn:kixx:get', 'urn:kixx:publishing:releases'));
            assertEqual(true, isAuthorized(ROLE_EDITOR, 'urn:kixx:create', 'urn:kixx:publishing:objects'));
        });
    });
});
