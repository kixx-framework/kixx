import { assert, assertNonEmptyString, isString } from '../../kixx/assertions/mod.js';
import { evaluatePermissions } from './permissions.js';


const ALLOW = 'allow';

/**
 * Persistence-contract role name for the bootstrap, unrestricted admin role.
 * @type {string}
 */
export const ROLE_ROOT_ADMIN = 'Root Admin';

/**
 * Persistence-contract role name for the admin role that can grant
 * `Platform Admin` and manage invites, publishing tokens, and migrations.
 * @type {string}
 */
export const ROLE_SUPER_ADMIN = 'Super Admin';

/**
 * Persistence-contract role name for the admin role scoped to publishing
 * API token management.
 * @type {string}
 */
export const ROLE_PLATFORM_ADMIN = 'Platform Admin';

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
        { action: 'urn:kixx:admin:publishing-api-tokens:*', resource: 'urn:kixx:admin:publishing-api-tokens' },
        { action: 'urn:kixx:admin:migrations:*', resource: 'urn:kixx:admin:migrations' },
    ]),
    defineRole(ROLE_PLATFORM_ADMIN, [ 'admin' ], [
        { action: 'urn:kixx:admin:publishing-api-tokens:*', resource: 'urn:kixx:admin:publishing-api-tokens' },
    ]),
    defineRole(ROLE_EDITOR, [ 'publishing' ], [
        { action: 'urn:kixx:publishing:page-metadata:put', resource: 'urn:kixx:publishing:page-metadata:*' },
        { action: 'urn:kixx:publishing:include:put', resource: 'urn:kixx:publishing:include:*' },
        { action: 'urn:kixx:publishing:asset:put', resource: 'urn:kixx:publishing:asset' },
        { action: 'urn:kixx:publishing:template:put', resource: 'urn:kixx:publishing:template' },
    ]),
]);

const ROLE_REGISTRY = new Map(ROLE_DEFINITIONS.map((role) => [ role.name, role ]));


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
 * Lists registered roles within a category, in definition order. A role
 * belonging to several categories is listed under each of them.
 * @param {string} category - Required role category, such as 'admin' or 'publishing'.
 * @returns {Object[]} Frozen role definitions belonging to the category.
 */
export function listRoles(category) {
    assertNonEmptyString(category, 'listRoles: category');

    return ROLE_DEFINITIONS.filter((role) => role.categories.includes(category));
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

/**
 * Reports whether a granter's permissions authorize every grant a role
 * would confer. Evaluates each grant's action/resource pair independently
 * as a pattern-vs-pattern decision — deliberately conservative, with no
 * subset analysis of overlapping wildcard scopes.
 * @param {Object[]} permissions - The prospective granter's derived permissions.
 * @param {string} roleName - Candidate role name to grant.
 * @returns {boolean} True when the granter's permissions cover every grant of the role.
 */
export function canGrantRole(permissions, roleName) {
    const role = ROLE_REGISTRY.get(roleName);

    if (!role) {
        return false;
    }

    return role.permissions.every((grant) => {
        const actions = Array.isArray(grant.action) ? grant.action : [ grant.action ];

        return actions.every((action) => {
            return evaluatePermissions(permissions, { action, resource: grant.resource });
        });
    });
}

/**
 * Lists the roles within a category that a granter's permissions allow them
 * to confer, always excluding `Root Admin` regardless of the granter's
 * permissions.
 * @param {Object[]} permissions - The prospective granter's derived permissions.
 * @param {string} category - Required role category, such as 'admin' or 'publishing'.
 * @returns {Object[]} Role definitions the granter may confer, in definition order.
 */
export function filterGrantableRoles(permissions, category) {
    return listRoles(category).filter((role) => {
        return role.name !== ROLE_ROOT_ADMIN && canGrantRole(permissions, role.name);
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

function cloneGrant(grant) {
    return {
        effect: grant.effect,
        action: Array.isArray(grant.action) ? grant.action.slice() : grant.action,
        resource: grant.resource,
    };
}
