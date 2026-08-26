import {
    assert,
    assertNonEmptyString,
    isPlainObject,
    isString,
    isUndefined,
} from '../assertions/mod.js';
import { ForbiddenError } from '../errors/mod.js';


const WILDCARD = '*';
const DEFAULT_FORBIDDEN_MESSAGE = 'You are not authorized to perform this request.';


/**
 * Reports whether a value has the grant shape accepted by the evaluator.
 * @param {Object} grant - Candidate permission grant.
 * @param {string|string[]} grant.action - Allowed action patterns.
 * @param {string} grant.resource - Allowed resource pattern.
 * @returns {boolean} True when every required grant value is supported.
 */
export function isGrantShapeSupportedByEvaluator(grant) {
    return isPlainObject(grant) &&
        (isString(grant.action) || (
            Array.isArray(grant.action) &&
            grant.action.every(isString)
        )) &&
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

export function doesPatternMatch(pattern, value) {
    if (!isString(pattern) || !isString(value)) {
        return false;
    }

    if (pattern === WILDCARD || pattern === value) {
        return true;
    }

    // Keep the final colon in a scoped wildcard's prefix. This includes the
    // empty scope but prevents a bare or similarly named scope from matching.
    if (pattern.endsWith(`:${ WILDCARD }`)) {
        const prefix = pattern.slice(0, -1);
        return value.startsWith(prefix);
    }

    return false;
}

/**
 * Determines whether any grant allows an action on a resource. Grants are
 * allow-only; unsupported grants and requests without a match are denied.
 * @param {Object[]} permissions - Permission grants assigned to a principal.
 * @param {Object} request - Authorization decision request.
 * @param {string} request.action - Action being attempted.
 * @param {string} request.resource - Resource being accessed.
 * @returns {boolean} True when a supported grant matches the request.
 */
export function evaluatePermissions(permissions, request) {
    const { action, resource } = request ?? {};

    if (!Array.isArray(permissions) || !isString(action) || !isString(resource)) {
        return false;
    }

    for (const grant of permissions) {
        if (!isGrantShapeSupportedByEvaluator(grant)) {
            continue;
        }

        if (!doesGrantMatch(grant, { action, resource })) {
            continue;
        }

        return true;
    }

    return false;
}

/**
 * Requires an authenticated user to have permission for an action and resource.
 * Callers must authenticate the user before calling this function; an
 * unauthenticated request is a 401 raised upstream, not a denial here.
 * @param {Object} user - Authenticated user carrying assigned permissions.
 * @param {Object} decision - Authorization decision request.
 * @param {string} decision.action - Action being attempted.
 * @param {string} decision.resource - Resource being accessed.
 * @param {Object} [options] - Forbidden error overrides.
 * @param {string} [options.message] - Overrides the default error message.
 * @param {string} [options.code] - Overrides the default ForbiddenError code.
 * @returns {void}
 * @throws {ForbiddenError} When the user does not have a matching permission.
 */
export function requirePermission(user, decision, options) {
    assert(isPlainObject(user), 'requirePermission: user must be a plain object');
    assert(isPlainObject(decision), 'requirePermission: decision must be a plain object');

    // The decision is authored at the call site, so a malformed one is a bug.
    // Without these assertions a typo would deny the request and read as a
    // policy decision instead of the mistake it is.
    assertNonEmptyString(decision.action, 'requirePermission: decision.action');
    assertNonEmptyString(decision.resource, 'requirePermission: decision.resource');

    assert(
        isUndefined(options) || isPlainObject(options),
        'requirePermission: options must be a plain object',
    );

    const { message, code } = options ?? {};

    if (!isUndefined(message)) {
        assertNonEmptyString(message, 'requirePermission: options.message');
    }

    if (!isUndefined(code)) {
        assertNonEmptyString(code, 'requirePermission: options.code');
    }

    // The user's permissions come from storage, not from this call site.
    // Unsupported grants are skipped and the request is denied rather than
    // crashing the process over a stored value.
    if (evaluatePermissions(user.permissions, decision)) {
        return;
    }

    const errorOptions = {};

    // Omitting code preserves ForbiddenError's class default.
    if (!isUndefined(code)) {
        errorOptions.code = code;
    }

    throw new ForbiddenError(message || DEFAULT_FORBIDDEN_MESSAGE, errorOptions);
}
