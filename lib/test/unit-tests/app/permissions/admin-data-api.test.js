import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import {
    ADMIN_DATA_TOKEN_MANAGEMENT_RESOURCE,
    adminDataActionUrn,
    adminDataCollectionResource,
    isAdminDataAction,
    isAdminDataCollectionName,
    toAdminDataPermissions,
} from '../../../../src/app/permissions/admin-data-api.js';
import { deriveRolePermissions, ROLE_EDITOR, ROLE_ROOT_ADMIN } from '../../../../src/app/permissions/roles.js';
import { evaluatePermissions } from '../../../../src/kixx/permissions/permission-validation.js';


function isAllowed(permissions, action, collection) {
    return evaluatePermissions(permissions, {
        action: adminDataActionUrn(action),
        resource: adminDataCollectionResource(collection),
    });
}


describe('app/permissions/admin-data-api', ({ describe }) => {

    describe('identifiers', ({ it }) => {
        it('builds exact action and Collection resource URNs', () => {
            assertEqual('urn:kixx:list', adminDataActionUrn('list'));
            assertEqual('urn:kixx:admin-data:collections:File', adminDataCollectionResource('File'));
        });

        it('accepts only PascalCase identifier Collection names', () => {
            assertEqual(true, isAdminDataCollectionName('File'));
            assertEqual(true, isAdminDataCollectionName('FileContent2'));
            assertEqual(false, isAdminDataCollectionName('*'));
            assertEqual(false, isAdminDataCollectionName('File:*'));
            assertEqual(false, isAdminDataCollectionName('file'));
            assertEqual(false, isAdminDataCollectionName(''));
            assertEqual(false, isAdminDataCollectionName(undefined));
        });

        it('accepts only the five data actions', () => {
            for (const action of [ 'list', 'get', 'create', 'update', 'delete' ]) {
                assertEqual(true, isAdminDataAction(action));
            }
            assertEqual(false, isAdminDataAction('*'));
            assertEqual(false, isAdminDataAction('run'));
        });
    });

    describe('toAdminDataPermissions()', ({ it }) => {
        it('grants exactly the listed actions on exactly the listed Collection', () => {
            const permissions = toAdminDataPermissions([
                { collection: 'File', actions: [ 'list', 'get' ] },
            ]);

            assertEqual(true, isAllowed(permissions, 'list', 'File'));
            assertEqual(true, isAllowed(permissions, 'get', 'File'));
            assertEqual(false, isAllowed(permissions, 'update', 'File'));
            assertEqual(false, isAllowed(permissions, 'get', 'Release'));
            assertEqual(false, isAllowed(permissions, 'get', 'FileContent'));
        });

        it('skips stored grants that could widen access or are malformed', () => {
            const permissions = toAdminDataPermissions([
                { collection: '*', actions: [ 'get' ] },
                { collection: 'File:*', actions: [ 'get' ] },
                { collection: 'Release', actions: [ '*' ] },
                { collection: 'AdminUser', actions: 'get' },
                null,
                'File',
            ]);

            assertEqual(0, permissions.length);
            assertEqual(false, isAllowed(permissions, 'get', 'File'));
        });

        it('returns no permissions for a non-array value', () => {
            assertEqual(0, toAdminDataPermissions(undefined).length);
            assertEqual(0, toAdminDataPermissions({ collection: 'File', actions: [ 'get' ] }).length);
        });
    });

    describe('token management permission', ({ it }) => {
        function canManage(roleId, action) {
            return evaluatePermissions(deriveRolePermissions([ roleId ]), {
                action: `urn:kixx:${ action }`,
                resource: ADMIN_DATA_TOKEN_MANAGEMENT_RESOURCE,
            });
        }

        it('is held by Root Admin and Developer', () => {
            for (const roleId of [ ROLE_ROOT_ADMIN, 'developer' ]) {
                for (const action of [ 'list', 'create', 'delete' ]) {
                    assertEqual(true, canManage(roleId, action), `${ roleId } ${ action }`);
                }
            }
        });

        it('is not held by Admin or Editor', () => {
            for (const roleId of [ 'admin', ROLE_EDITOR ]) {
                assertEqual(false, canManage(roleId, 'create'), roleId);
            }
        });

        it('is not satisfied by role grants on data Collections', () => {
            // Admin panel roles manage tokens; they never act as data API principals.
            const permissions = deriveRolePermissions([ 'developer' ]);
            assertEqual(false, isAllowed(permissions, 'get', 'File'));
        });
    });
});
