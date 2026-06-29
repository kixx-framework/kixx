import {
    isPlainObject,
    isString,
} from '../../kixx/assertions/mod.js';
import { ValidationError } from '../../kixx/errors/mod.js';


const WILDCARD = '*';
const ALLOW = 'allow';
const DENY = 'deny';
const VALID_EFFECTS = new Set([ ALLOW, DENY ]);

// Scoped grants use stable URNs for both sides of the decision: actions as
// `urn:kixx:publishing:<capability>:<verb>` and resources as
// `urn:kixx:publishing:<resource-kind>:<scope>`, where the trailing scope is a
// concrete value or a '*' wildcard (see doesPatternMatch). Resource URNs do not
// encode the target build id — template and page-metadata authorization is
// independent of which build the write targets.


/**
 * Validates the supported Publishing API permission grammar.
 * @param {*} permissions - Candidate permission grants from a request body.
 * @returns {void}
 * @throws {ValidationError} When the permission grants are missing or unsupported.
 */
export function validatePermissions(permissions) {
    const error = new ValidationError('The publishing API token permissions are invalid');

    if (!Array.isArray(permissions) || permissions.length === 0) {
        error.push('Permissions must be a non-empty array', 'permissions');
    } else if (!isWildcardAllowAllGrant(permissions)) {
        error.push('Only the allow-all publishing permission grant is supported', 'permissions');
    }

    if (error.length) {
        throw error;
    }
}

/**
 * Evaluates Publishing API permission grants for one action and resource.
 * @param {Object[]} permissions - Permission grants stored on a token.
 * @param {Object} request - Authorization decision request.
 * @param {string} request.action - Action being attempted.
 * @param {string} request.resource - Resource being accessed.
 * @returns {boolean} True when the grants authorize the requested action.
 */
export function evaluatePermissions(permissions, request) {
    const { action, resource } = request ?? {};

    if (!Array.isArray(permissions) || !isString(action) || !isString(resource)) {
        return false;
    }

    let isAllowed = false;

    for (const grant of permissions) {
        if (!isGrantShapeSupportedByEvaluator(grant)) {
            continue;
        }

        if (!doesGrantMatch(grant, { action, resource })) {
            continue;
        }

        if (grant.effect === DENY) {
            return false;
        }

        if (grant.effect === ALLOW) {
            isAllowed = true;
        }
    }

    return isAllowed;
}

function isWildcardAllowAllGrant(permissions) {
    if (permissions.length !== 1) {
        return false;
    }

    const grant = permissions[0];
    const keys = isPlainObject(grant) ? Object.keys(grant) : [];

    return keys.length === 3 &&
        grant.effect === ALLOW &&
        Array.isArray(grant.action) &&
        grant.action.length === 1 &&
        grant.action[0] === WILDCARD &&
        grant.resource === WILDCARD;
}

function isGrantShapeSupportedByEvaluator(grant) {
    return isPlainObject(grant) &&
        VALID_EFFECTS.has(grant.effect) &&
        (isString(grant.action) || Array.isArray(grant.action)) &&
        isString(grant.resource);
}

function doesGrantMatch(grant, request) {
    return doesActionMatch(grant.action, request.action) &&
        doesPatternMatch(grant.resource, request.resource);
}

function doesActionMatch(grantAction, requestedAction) {
    const grantActions = Array.isArray(grantAction) ? grantAction : [ grantAction ];

    return grantActions.some((action) => {
        return doesPatternMatch(action, requestedAction);
    });
}

function doesPatternMatch(pattern, value) {
    if (pattern === WILDCARD || pattern === value) {
        return true;
    }

    // A trailing ':*' is a scoped wildcard: it matches any value sharing the
    // pattern's prefix up to and including that final colon, with a non-empty
    // remainder. For example, 'urn:kixx:publishing:page-metadata:*' matches
    // 'urn:kixx:publishing:page-metadata:/blog/hello'. slice(0, -1) drops only the
    // '*', keeping the ':' so a bare prefix (without the colon) cannot match.
    if (pattern.endsWith(`:${ WILDCARD }`)) {
        const prefix = pattern.slice(0, -1);
        return value.startsWith(prefix) && value.length > prefix.length;
    }

    return false;
}
