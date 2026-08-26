import { assert, assertNonEmptyString, isString } from '../../kixx/assertions/mod.js';
import deepFreeze from '../../kixx/utils/deep-freeze.js';


const EDITOR_CATEGORY = 'editor';
const PUBLISHING_URN_PREFIX = 'urn:kixx:publishing:';
const EDITOR_ACTIONS = new Set([ 'urn:kixx:get', 'urn:kixx:create' ]);

/** @type {string} */
export const ROLE_ROOT_ADMIN = 'root-admin';

/** @type {string} */
export const ROLE_EDITOR = 'editor';

// Actions are bare verb URNs and resources carry every bit of specificity. A
// resource naming a whole collection is distinct from one ending in ':*'.
const ROLE_DEFINITIONS = deepFreeze([
    {
        id: ROLE_ROOT_ADMIN,
        name: 'Root Admin',
        categories: [],
        permissions: [
            { action: '*', resource: '*' },
        ],
    },
    {
        id: 'developer',
        name: 'Developer',
        categories: [ 'admin' ],
        permissions: [
            { action: 'urn:kixx:grant-role', resource: 'urn:kixx:admin:role:*' },
            { action: '*', resource: 'urn:kixx:admin:user-invites' },
            {
                action: [ 'urn:kixx:get', 'urn:kixx:create' ],
                resource: 'urn:kixx:publishing:*',
            },
            { action: '*', resource: 'urn:kixx:admin:api-tokens:*' },
            { action: '*', resource: 'urn:kixx:admin:migrations' },
        ],
    },
    {
        id: 'admin',
        name: 'Admin',
        categories: [ 'admin' ],
        permissions: [
            { action: 'urn:kixx:grant-role', resource: 'urn:kixx:admin:role:*' },
            { action: '*', resource: 'urn:kixx:admin:user-invites' },
            {
                action: [ 'urn:kixx:get', 'urn:kixx:create' ],
                resource: 'urn:kixx:publishing:*',
            },
        ],
    },
    {
        id: ROLE_EDITOR,
        name: 'Editor',
        categories: [ 'admin', EDITOR_CATEGORY ],
        permissions: [
            {
                action: [ 'urn:kixx:get', 'urn:kixx:create' ],
                resource: 'urn:kixx:publishing:*',
            },
        ],
    },
]);

assertRoleDefinitions(ROLE_DEFINITIONS);

const ROLE_REGISTRY = new Map(ROLE_DEFINITIONS.map((role) => [ role.id, role ]));


/**
 * Derives grants for role ids, skipping ids the registry does not recognize.
 * @param {string[]} roleIds - Role ids held by a principal.
 * @returns {Object[]} Fresh grants without effect fields.
 */
export function deriveRolePermissions(roleIds) {
    if (!Array.isArray(roleIds)) {
        return [];
    }

    const permissions = [];

    for (const id of roleIds) {
        const role = ROLE_REGISTRY.get(id);

        if (!role) {
            continue;
        }

        for (const grant of role.permissions) {
            permissions.push(cloneGrant(grant));
        }
    }

    return permissions;
}

/**
 * Reports whether an id belongs to a registered role in a category.
 * @param {string} id - Candidate role id.
 * @param {string} category - Required attachment category.
 * @returns {boolean} True when the role exists and carries the category.
 */
export function isRoleId(id, category) {
    assertNonEmptyString(category, 'isRoleId: category');

    const role = ROLE_REGISTRY.get(id);
    return Boolean(role) && role.categories.includes(category);
}

/**
 * Lists roles attachable in a category, most capable first.
 * @param {string} category - Required attachment category.
 * @returns {Object[]} Fresh objects exposing each role's id and display name.
 */
export function listAttachableRoles(category) {
    assertNonEmptyString(category, 'listAttachableRoles: category');

    return ROLE_DEFINITIONS
        .filter((role) => role.categories.includes(category))
        .map((role) => ({ id: role.id, name: role.name }));
}

function assertRoleDefinitions(roles) {
    const ids = new Set();

    for (const role of roles) {
        assert(!ids.has(role.id), `Role id '${ role.id }' must be unique`);
        ids.add(role.id);

        assert(Array.isArray(role.categories), `Role '${ role.id }' categories must be an array`);

        if (role.id === ROLE_ROOT_ADMIN) {
            assert(role.categories.length === 0, `'${ ROLE_ROOT_ADMIN }' must not carry a category`);
        } else {
            assert(role.categories.length > 0, `Role '${ role.id }' categories must not be empty`);
        }

        for (const grant of role.permissions) {
            assert(!Object.hasOwn(grant, 'effect'), `Role '${ role.id }' grants must not declare an effect`);
        }

        if (role.categories.includes(EDITOR_CATEGORY)) {
            assertPublishingGrants(role);
        }
    }
}

function assertPublishingGrants(role) {
    for (const grant of role.permissions) {
        const actions = Array.isArray(grant.action) ? grant.action : [ grant.action ];
        const actionsArePublishing = actions.every((action) => EDITOR_ACTIONS.has(action));

        assert(
            actionsArePublishing && isString(grant.resource) && grant.resource.startsWith(PUBLISHING_URN_PREFIX),
            `Editor role '${ role.id }' grants must stay within the publishing URN domain`,
        );
    }
}

function cloneGrant(grant) {
    return {
        action: Array.isArray(grant.action) ? grant.action.slice() : grant.action,
        resource: grant.resource,
    };
}
