import {
    assert,
    assertNonEmptyString,
    isString,
    isFunction,
    isUndefined,
    isNonEmptyString,
} from '../../../kixx/assertions/mod.js';
import { assertPermission } from '../../lib/permissions.js';


/**
 * Creates route-attached authorization middleware for one action/resource
 * decision. The spec is validated when this factory is called — at
 * route-module load time — so a misconfigured route crashes at startup
 * instead of failing on the first request that hits it.
 * @param {Object} spec - Authorization decision specification.
 * @param {string} spec.action - Action being attempted; a required non-empty string.
 * @param {string|Function} spec.resource - Static resource URN, or a
 *   `(context, request) => string` resolver invoked per request to compute one.
 * @param {string} [spec.code] - Overrides the default `ForbiddenError` code.
 * @param {string} [spec.message] - Overrides the default forbidden message.
 * @returns {Function} Named `(context, request, response)` middleware enforcing the decision.
 * @throws {AssertionError} When the spec is missing a required field or has an unsupported shape.
 */
export function requirePermission(spec) {
    const { action, resource, code, message } = spec ?? {};

    assertNonEmptyString(action, 'requirePermission: action');
    assert(
        isNonEmptyString(resource) || isFunction(resource),
        'requirePermission: resource must be a non-empty string or a resolver function',
    );

    // Only forward keys the caller actually supplied so assertPermission()'s
    // defaults (generic message, ForbiddenError's class-default code) apply
    // when this route did not override them.
    const assertionOptions = {};

    if (!isUndefined(code)) {
        assert(isString(code), 'requirePermission: code must be a string when provided');
        assertionOptions.code = code;
    }
    if (!isUndefined(message)) {
        assert(isString(message), 'requirePermission: message must be a string when provided');
        assertionOptions.message = message;
    }

    return function enforcePermission(context, request, response) {
        // A resolver may throw (for example a BadRequestError for a malformed
        // pathname); that error is ordinary client input and must propagate
        // untouched rather than being caught and reframed as a 403.
        const resolvedResource = isFunction(resource) ? resource(context, request) : resource;

        assertPermission(context, { action, resource: resolvedResource }, assertionOptions);

        return response;
    };
}
