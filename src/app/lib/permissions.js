import {
    isPlainObject,
    isString,
} from '../../kixx/assertions/mod.js';
import { ForbiddenError } from '../../kixx/errors/mod.js';


const WILDCARD = '*';
const ALLOW = 'allow';
const DENY = 'deny';
const VALID_EFFECTS = new Set([ ALLOW, DENY ]);

const DEFAULT_FORBIDDEN_MESSAGE = 'You are not authorized to perform this request.';

// Scoped grants use stable URNs for both sides of the decision: actions as
// `urn:kixx:<domain>:<capability>:<verb>` and resources as
// `urn:kixx:<domain>:<resource-kind>:<scope>`, where the trailing scope is a
// concrete value or a '*' wildcard (see doesPatternMatch). URNs are an
// internal authorization contract only — they are never persisted or
// serialized to clients.


/**
 * Evaluates permission grants for one action and resource. Deny grants
 * override allow grants, and a decision with no matching allow grant is
 * denied by default.
 * @param {Object[]} permissions - Permission grants derived onto a principal.
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

/**
 * Asserts that the authenticated principal on a request context is
 * authorized for a decision, evaluating `context.user.permissions`.
 * @param {Object} context - Active request context carrying `context.user`.
 * @param {Object} decision - Authorization decision request.
 * @param {string} decision.action - Action being attempted.
 * @param {string} decision.resource - Resource being accessed.
 * @param {Object} [options] - Error override options.
 * @param {string} [options.message] - Overrides the default forbidden message.
 * @param {string} [options.code] - Overrides the default ForbiddenError code.
 * @returns {void}
 * @throws {ForbiddenError} When the principal's permissions do not authorize the decision.
 */
export function assertPermission(context, decision, options) {
    const isAllowed = evaluatePermissions(context.user?.permissions, decision);

    if (isAllowed) {
        return;
    }

    const { message, code } = options ?? {};

    // Only forward code when the caller supplied one; ForbiddenError falls
    // back to its class default when the key is omitted entirely.
    const errorOptions = {};
    if (typeof code !== 'undefined') {
        errorOptions.code = code;
    }

    throw new ForbiddenError(message || DEFAULT_FORBIDDEN_MESSAGE, errorOptions);
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
