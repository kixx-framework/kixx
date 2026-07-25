import { assert, assertNonEmptyString, isString } from '../../kixx/assertions/mod.js';


const ALLOW = 'allow';
const ADMIN_ROLE_CATEGORY = 'admin';

/**
 * Persistence-contract role name for the bootstrap, unrestricted admin role.
 * @type {string}
 */
export const ROLE_ROOT_ADMIN = 'Root Admin';

/**
 * Persistence-contract role name for the admin role scoped to inviting new
 * admin users.
 * @type {string}
 */
export const ROLE_SUPER_ADMIN = 'Super Admin';

/**
 * Persistence-contract role name for the admin role scoped to publishing API
 * token management and running migrations.
 * @type {string}
 */
export const ROLE_DEVELOPER_ADMIN = 'Developer Admin';

/**
 * Persistence-contract role name for the publishing role that can write
 * page metadata, includes, assets, and templates.
 * @type {string}
 */
export const ROLE_EDITOR = 'Editor';

// Role names are a single namespace shared across every category; each name
// below is unique across the whole registry, not just within its categories.
// A role may belong to more than one category when the same grants should be
// attachable to more than one kind of principal — the categories a role
// declares govern only where it may be attached, never what it can do.
const ROLE_DEFINITIONS = Object.freeze([
    defineRole(ROLE_ROOT_ADMIN, [ 'admin' ], [
        { action: '*', resource: '*' },
    ]),
    defineRole(ROLE_SUPER_ADMIN, [ 'admin' ], [
        { action: 'urn:kixx:admin:admin-user-invites:*', resource: 'urn:kixx:admin:admin-user-invites' },
    ]),
    defineRole(ROLE_DEVELOPER_ADMIN, [ 'admin' ], [
        { action: 'urn:kixx:admin:publishing-api-tokens:*', resource: 'urn:kixx:admin:publishing-api-tokens' },
        { action: 'urn:kixx:admin:migrations:*', resource: 'urn:kixx:admin:migrations' },
    ]),
    defineRole(ROLE_EDITOR, [ 'admin', 'publishing' ], [
        { action: 'urn:kixx:publishing:page-metadata:put', resource: 'urn:kixx:publishing:page-metadata:*' },
        { action: 'urn:kixx:publishing:include:put', resource: 'urn:kixx:publishing:include:*' },
        { action: 'urn:kixx:publishing:asset:put', resource: 'urn:kixx:publishing:asset' },
        { action: 'urn:kixx:publishing:template:put', resource: 'urn:kixx:publishing:template' },
    ]),
]);

const ROLE_REGISTRY = new Map(ROLE_DEFINITIONS.map((role) => [ role.name, role ]));

/**
 * Role preset conferring the full developer capability set on a new admin user.
 * The value deliberately equals `ROLE_DEVELOPER_ADMIN`: a preset id *is* its
 * display name, and this preset is named for its most capable member. The two
 * constants are distinct concepts that happen to share a string — do not
 * collapse them.
 * @type {string}
 */
export const PRESET_DEVELOPER_ADMIN = 'Developer Admin';

/**
 * Role preset conferring site ownership — inviting other admins and editing
 * published content — without developer capabilities.
 * @type {string}
 */
export const PRESET_OWNER_ADMIN = 'Owner Admin';

/**
 * Role preset conferring content editing only.
 * @type {string}
 */
export const PRESET_EDITOR_ADMIN = 'Editor Admin';

// Membership is written out one role at a time rather than derived from the
// role registry, so defining a new role can never silently widen an existing
// preset. Definition order is the render order in the invite form, most
// capable first.
const PRESET_DEFINITIONS = Object.freeze([
    definePreset(PRESET_DEVELOPER_ADMIN, [ ROLE_DEVELOPER_ADMIN, ROLE_SUPER_ADMIN, ROLE_EDITOR ]),
    definePreset(PRESET_OWNER_ADMIN, [ ROLE_SUPER_ADMIN, ROLE_EDITOR ]),
    definePreset(PRESET_EDITOR_ADMIN, [ ROLE_EDITOR ]),
]);

const PRESET_REGISTRY = new Map(PRESET_DEFINITIONS.map((preset) => [ preset.name, preset ]));

// Presets are the sole authority for what an invite may confer, so the table is
// proven safe at module load rather than re-checked per request: every member
// must be an attachable admin role, and Root Admin must stay unreachable by
// invite (the env bootstrap token is its only path). A definition mistake fails
// the import, before any request is served.
for (const preset of PRESET_DEFINITIONS) {
    for (const roleName of preset.roles) {
        assert(
            roleName !== ROLE_ROOT_ADMIN,
            `Role preset '${ preset.name }' must not include '${ ROLE_ROOT_ADMIN }'`,
        );
        assert(
            isRoleName(roleName, ADMIN_ROLE_CATEGORY),
            `Role preset '${ preset.name }' member '${ roleName }' must be a registered ${ ADMIN_ROLE_CATEGORY } role`,
        );
    }
}


/**
 * Lists the registered role presets in definition order, most capable first.
 * @returns {Object[]} Frozen preset definitions, each with `name` and frozen `roles`.
 */
export function listRolePresets() {
    return PRESET_DEFINITIONS;
}

/**
 * Expands a preset name into the role names it confers. Returns `null` for an
 * unregistered name so callers fail closed by default: unlike a retired role
 * name on a stored record, an unrecognized preset is an authorization decision
 * that must be refused rather than treated as conferring nothing.
 * @param {string} name - Candidate preset name.
 * @returns {string[]|null} A fresh, mutation-safe array of member role names, or null when unregistered.
 */
export function resolveRolePreset(name) {
    const preset = PRESET_REGISTRY.get(name);

    if (!preset) {
        return null;
    }

    return preset.roles.slice();
}

/**
 * Reports whether a name is registered in any category.
 * @param {string} name - Candidate role name.
 * @returns {boolean} True when the name is a registered role.
 */
export function isRegisteredRoleName(name) {
    return ROLE_REGISTRY.has(name);
}

/**
 * Reports whether a name is a registered role within a specific category. A
 * role belonging to several categories matches every one of them.
 * @param {string} name - Candidate role name.
 * @param {string} category - Required role category, such as 'admin' or 'publishing'.
 * @returns {boolean} True when the name is registered and belongs to the category.
 */
export function isRoleName(name, category) {
    assertNonEmptyString(category, 'isRoleName: category');

    const role = ROLE_REGISTRY.get(name);
    return Boolean(role) && role.categories.includes(category);
}

/**
 * Derives the permission grants conferred by a set of role names. Unknown
 * role names are skipped rather than rejected, so a since-retired role
 * confers nothing instead of failing the caller.
 * @param {string[]} roleNames - Role names held by a principal.
 * @returns {Object[]} Cloned, mutation-safe grants from every registered name.
 */
export function deriveRolePermissions(roleNames) {
    if (!Array.isArray(roleNames)) {
        return [];
    }

    const permissions = [];

    for (const name of roleNames) {
        const role = ROLE_REGISTRY.get(name);

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
 * Reports whether every grant held by a role — both action and resource,
 * on every grant regardless of effect — is confined to a URN domain.
 * @param {string} roleName - Candidate role name.
 * @param {string} domain - Required URN domain, such as 'admin' or 'publishing'.
 * @returns {boolean} True when the role is registered and fully within the domain.
 */
export function areRoleGrantsWithinDomain(roleName, domain) {
    assertNonEmptyString(domain, 'areRoleGrantsWithinDomain: domain');

    const role = ROLE_REGISTRY.get(roleName);

    if (!role) {
        return false;
    }

    const prefix = `urn:kixx:${ domain }:`;

    return role.permissions.every((grant) => {
        const actions = Array.isArray(grant.action) ? grant.action : [ grant.action ];

        const actionsWithinDomain = actions.every((action) => {
            return isString(action) && action.startsWith(prefix);
        });

        return actionsWithinDomain && isString(grant.resource) && grant.resource.startsWith(prefix);
    });
}

function defineRole(name, categories, permissions) {
    // A bare string would silently pass every category check downstream,
    // because String#includes() matches substrings: 'admin'.includes('admin')
    // and even 'admin'.includes('admi') are both true. Reject it at module
    // load rather than let a definition typo widen a role's reach.
    assert(
        Array.isArray(categories) && categories.length > 0,
        `defineRole: categories for role '${ name }' must be a non-empty array`,
    );

    const grants = permissions.map((grant) => {
        return Object.freeze({
            effect: ALLOW,
            action: grant.action,
            resource: grant.resource,
        });
    });

    return Object.freeze({
        name,
        categories: Object.freeze(categories.slice()),
        permissions: Object.freeze(grants),
    });
}

// Freezing both the definition and its member list keeps a caller from
// reshaping the table that authorizes invites; resolveRolePreset() hands out
// copies for the same reason cloneGrant() does.
function definePreset(name, roles) {
    return Object.freeze({
        name,
        roles: Object.freeze(roles.slice()),
    });
}

function cloneGrant(grant) {
    return {
        effect: grant.effect,
        action: Array.isArray(grant.action) ? grant.action.slice() : grant.action,
        resource: grant.resource,
    };
}
