import { readFile } from 'node:fs/promises';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches, assertUndefined } from 'kixx-assert';

import {
    deriveRolePermissions,
    isRoleId,
    listAttachableRoles,
    ROLE_EDITOR,
    ROLE_ROOT_ADMIN,
} from '../../../../src/app/permissions/roles.js';


describe('roles', ({ it }) => {

    it('exports only the role registry API', async () => {
        const roles = await import('../../../../src/app/permissions/roles.js');

        assertEqual(JSON.stringify([
            'ROLE_EDITOR',
            'ROLE_ROOT_ADMIN',
            'deriveRolePermissions',
            'isRoleId',
            'listAttachableRoles',
        ]), JSON.stringify(Object.keys(roles).sort()));
    });

    it('uses canonical ids for named roles', () => {
        assertEqual('root-admin', ROLE_ROOT_ADMIN);
        assertEqual('editor', ROLE_EDITOR);
    });

    it('returns no permissions for invalid or retired role identifiers', () => {
        assertEqual(0, deriveRolePermissions(null).length);
        assertEqual(0, deriveRolePermissions([ 'not-registered' ]).length);
        assertEqual(0, deriveRolePermissions([ 'Editor' ]).length);
    });

    it('returns grants without effect fields', () => {
        const permissions = deriveRolePermissions([ ROLE_EDITOR ]);

        assert(permissions.length > 0);

        for (const grant of permissions) {
            assertUndefined(grant.effect);
        }
    });

    it('returns mutation-safe permission copies', () => {
        const first = deriveRolePermissions([ ROLE_EDITOR ]);

        first[0].resource = 'changed';
        first[0].action.push('changed');

        const second = deriveRolePermissions([ ROLE_EDITOR ]);

        assertEqual('urn:kixx:publishing:*', second[0].resource);
        assertEqual('urn:kixx:get,urn:kixx:create', second[0].action.join(','));
    });

    it('matches every category carried by a role', () => {
        assert(isRoleId(ROLE_EDITOR, 'admin'));
        assert(isRoleId(ROLE_EDITOR, 'editor'));
        assertFalsy(isRoleId(ROLE_EDITOR, 'developer'));
        assertFalsy(isRoleId('not-registered', 'admin'));
    });

    it('lists attachable roles in capability order using copies', () => {
        const roles = listAttachableRoles('admin');

        assertEqual(JSON.stringify([
            { id: 'developer', name: 'Developer' },
            { id: 'admin', name: 'Admin' },
            { id: 'editor', name: 'Editor' },
        ]), JSON.stringify(roles));
        assertFalsy(roles.some((role) => role.id === ROLE_ROOT_ADMIN));

        roles[0].name = 'Changed';

        assertEqual('Developer', listAttachableRoles('admin')[0].name);
    });

    it('rejects duplicate role ids when the module loads', async () => {
        const error = await importInvalidDefinition(
            "id: 'developer',",
            'id: ROLE_ROOT_ADMIN,',
        );

        assertMatches('must be unique', error.message);
    });

    it('rejects a category on Root Admin when the module loads', async () => {
        const error = await importInvalidDefinition(
            'categories: [],',
            "categories: [ 'admin' ],",
        );

        assertMatches('must not carry a category', error.message);
    });

    it('rejects a non-array category list when the module loads', async () => {
        const error = await importInvalidDefinition(
            "categories: [ 'admin', EDITOR_CATEGORY ],",
            "categories: 'admin',",
        );

        assertMatches('categories must be an array', error.message);
    });

    it('rejects editor grants outside publishing when the module loads', async () => {
        const error = await importInvalidDefinition(
            "resource: 'urn:kixx:publishing:*',\n            },\n        ],\n    },\n]);",
            "resource: 'urn:kixx:admin:*',\n            },\n        ],\n    },\n]);",
        );

        assertMatches('must stay within the publishing URN domain', error.message);
    });
});

async function importInvalidDefinition(original, replacement) {
    const filepath = new URL('../../../../src/app/permissions/roles.js', import.meta.url);
    let source = await readFile(filepath, 'utf8');

    assert(source.includes(original), 'expected roles source fixture to match');

    source = source
        .replace(
            "import { assert, assertNonEmptyString, isString } from '../../kixx/assertions/mod.js';",
            "const assert = (value, message) => { if (!value) throw new Error(message); }; const assertNonEmptyString = () => {}; const isString = (value) => typeof value === 'string';",
        )
        .replace(
            "import deepFreeze from '../../kixx/utils/deep-freeze.js';",
            'const deepFreeze = (value) => value;',
        )
        .replace(original, replacement);

    try {
        await import(`data:text/javascript,${ encodeURIComponent(source) }`);
    } catch (error) {
        return error;
    }

    return null;
}
