import deepFreeze from '../../kixx/utils/deep-freeze.js';

export const roles = deepFreeze([
    {
        name: 'Root Admin',
        id: 'root-admin',
        categories: [],
        permissions: [
            {
                actions: [ '*' ],
                resource: '*',
            },
        ],
    },
    {
        name: 'Developer',
        id: 'devloper-admin',
        categories: [ 'developer' ],
        permissions: [
            {
                actions: [ 'urn:kixx:grant-role' ],
                resource: 'urn:kixx:admin:role:*',
            },
            {
                actions: [ '*' ],
                resource: 'urn:kixx:admin:user-invites:*',
            },
            {
                actions: [ 'urn:kixx:write', 'urn:kixx:read' ],
                resource: 'urn:kixx:publishing:*',
            },
            {
                actions: [ '*' ],
                resource: 'urn:kixx:admin:api-tokens:*',
            },
            {
                actions: [ '*' ],
                resource: 'urn:kixx:admin:migrations:*',
            },
        ],
    },
    {
        name: 'Admin',
        id: 'super-admin',
        categories: [ 'admin' ],
        permissions: [
            {
                actions: [ 'urn:kixx:grant-role' ],
                resource: 'urn:kixx:admin:role:*',
            },
            {
                actions: [ '*' ],
                resource: 'urn:kixx:admin:user-invites:*',
            },
            {
                actions: [ 'urn:kixx:write', 'urn:kixx:read' ],
                resource: 'urn:kixx:publishing:*',
            },
        ],
    },
    {
        name: 'Editor',
        id: 'editor-admin',
        categories: [ 'admin', 'editor' ],
        permissions: [
            {
                actions: [ 'urn:kixx:write', 'urn:kixx:read' ],
                resource: 'urn:kixx:publishing:*',
            },
        ],
    },
]);
