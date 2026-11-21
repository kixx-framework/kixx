import { isNonEmptyString, isPlainObject } from '../../kixx/assertions/mod.js';


/**
 * Actions an Administrative Data API token grant may name, in display order.
 * Each maps to the bare verb URN `urn:kixx:<action>` used by the evaluator.
 * @type {ReadonlyArray<string>}
 */
export const ADMIN_DATA_ACTIONS = Object.freeze([ 'list', 'get', 'create', 'update', 'delete' ]);

/**
 * Resource guarding Administrative Data API token management in the admin
 * panel. Root Admin holds it through its global wildcard and Developer through
 * `urn:kixx:admin:api-tokens:*`; no other role carries it.
 * @type {string}
 */
export const ADMIN_DATA_TOKEN_MANAGEMENT_RESOURCE = 'urn:kixx:admin:api-tokens:admin-data';

const COLLECTION_RESOURCE_PREFIX = 'urn:kixx:admin-data:collections:';

// Collection names become the tail of a resource URN. Restricting them to
// identifier characters keeps a stored name from ever forming a wildcard
// pattern such as `*` or `File:*` when it reaches the evaluator.
const COLLECTION_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

const ACTION_SET = new Set(ADMIN_DATA_ACTIONS);


/**
 * Reports whether a value can name a Collection in an Administrative Data API
 * resource URN.
 * @param {*} name - Candidate Collection name.
 * @returns {boolean} True for a PascalCase identifier such as `File`.
 */
export function isAdminDataCollectionName(name) {
    return isNonEmptyString(name) && COLLECTION_NAME_PATTERN.test(name);
}

/**
 * Reports whether a value is a supported Administrative Data API action.
 * @param {*} action - Candidate action name.
 * @returns {boolean} True for one of ADMIN_DATA_ACTIONS.
 */
export function isAdminDataAction(action) {
    return ACTION_SET.has(action);
}

/**
 * Builds the exact resource URN authorizing access to one Collection.
 * @param {string} collection - Registered Collection name.
 * @returns {string} Resource URN, for example `urn:kixx:admin-data:collections:File`.
 */
export function adminDataCollectionResource(collection) {
    return `${ COLLECTION_RESOURCE_PREFIX }${ collection }`;
}

/**
 * Builds the action URN for an Administrative Data API action.
 * @param {string} action - One of ADMIN_DATA_ACTIONS.
 * @returns {string} Action URN, for example `urn:kixx:list`.
 */
export function adminDataActionUrn(action) {
    return `urn:kixx:${ action }`;
}

/**
 * Converts stored token grants into evaluator permission grants.
 *
 * Token grants come from storage, so malformed entries, unknown actions, and
 * names that could form wildcard patterns are skipped rather than thrown: a
 * bad stored value must deny access, never crash a request or widen it.
 * Whether the Collection is still registered is checked separately at
 * authorization time, so retired grants confer no access.
 *
 * @param {Object[]} grants - Stored token grants.
 * @param {string} grants[].collection - Collection name.
 * @param {string[]} grants[].actions - Granted actions.
 * @returns {Object[]} Fresh evaluator grants with exact action and resource URNs.
 */
export function toAdminDataPermissions(grants) {
    if (!Array.isArray(grants)) {
        return [];
    }

    const permissions = [];

    for (const grant of grants) {
        if (!isPlainObject(grant) || !isAdminDataCollectionName(grant.collection) || !Array.isArray(grant.actions)) {
            continue;
        }

        const actions = grant.actions.filter(isAdminDataAction).map(adminDataActionUrn);

        if (actions.length > 0) {
            permissions.push({
                action: actions,
                resource: adminDataCollectionResource(grant.collection),
            });
        }
    }

    return permissions;
}
