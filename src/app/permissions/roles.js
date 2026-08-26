import deepFreeze from '../../kixx/utils/deep-freeze.js';

// Actions are bare verb URNs and resources carry every bit of specificity, so
// the two sides of a decision stay readable at the route. The verb set is
// closed: 'get', 'list', 'create', 'run', 'revoke', and 'grant-role'. Add a
// verb here before using it in a route, or the route denies every principal
// but Root Admin.
//
// A resource URN naming a whole resource ('urn:kixx:admin:migrations') is
// distinct from one naming a scope within it ('urn:kixx:admin:api-tokens:*').
// A trailing ':*' keeps its colon when matching, so a scoped grant never
// matches the bare resource; grant whichever form the routes request.

export const roles = deepFreeze([
    {
        name: 'Root Admin',
        id: 'root-admin',
        categories: [],
        permissions: [
            {
                action: '*',
                resource: '*',
            },
        ],
    },
    {
        name: 'Developer',
        id: 'developer-admin',
        categories: [ 'developer' ],
        permissions: [
            {
                action: 'urn:kixx:grant-role',
                resource: 'urn:kixx:admin:role:*',
            },
            {
                action: '*',
                resource: 'urn:kixx:admin:user-invites',
            },
            {
                action: [ 'urn:kixx:get', 'urn:kixx:create' ],
                resource: 'urn:kixx:publishing:*',
            },
            {
                action: '*',
                resource: 'urn:kixx:admin:api-tokens:*',
            },
            {
                action: '*',
                resource: 'urn:kixx:admin:migrations',
            },
        ],
    },
    {
        name: 'Admin',
        id: 'super-admin',
        categories: [ 'admin' ],
        permissions: [
            {
                action: 'urn:kixx:grant-role',
                resource: 'urn:kixx:admin:role:*',
            },
            {
                action: '*',
                resource: 'urn:kixx:admin:user-invites',
            },
            {
                action: [ 'urn:kixx:get', 'urn:kixx:create' ],
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
                action: [ 'urn:kixx:get', 'urn:kixx:create' ],
                resource: 'urn:kixx:publishing:*',
            },
        ],
    },
]);
