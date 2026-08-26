/**
 * Route-attached authorization gate for the admin panel, admin API, and
 * publishing API.
 *
 * Every decision is validated when the gate is built — at route-module load
 * time — so a misconfigured route fails the import instead of throwing on the
 * first request that reaches it.
 *
 * A gate reads `context.user`, so it must be attached downstream of the
 * authentication middleware that assigns the principal. An unauthenticated
 * request is a 401 raised by that middleware, never a denial here; reaching a
 * gate with no user is a route wiring bug and crashes.
 *
 * @module authorize
 * @see import('../../../kixx/permissions/permission-validation.js').requirePermission for the evaluated decision and thrown error.
 */

import {
    assert,
    assertNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import { requirePermission } from '../../../kixx/permissions/permission-validation.js';


/**
 * Builds middleware requiring the authenticated principal to satisfy every
 * listed decision. Decisions are conjunctive: the first one the principal
 * cannot satisfy throws, and the request handlers behind the gate never run.
 * Express alternatives ("read or write") within a single decision instead, by
 * granting an action array in the role definition.
 * @param {Object[]} decisions - Authorization decisions, at least one, all required.
 * @param {string} decisions[].action - Action URN being attempted; a non-empty string.
 * @param {string} decisions[].resource - Resource URN being accessed; a non-empty string.
 * @param {Object} [options] - Forbidden error overrides applied to every decision.
 * @param {string} [options.message] - Overrides the default forbidden message.
 * @param {string} [options.code] - Overrides the default ForbiddenError code.
 * @returns {Function} Named `(context, request, response)` middleware returning the response it was
 *   given, carrying its frozen `decisions` array so route manifests can be audited without a request.
 * @throws {AssertionError} When a decision or override is missing or malformed.
 */
export default function authorize(decisions, options) {
    // An empty array would authorize nothing and silently leave the route
    // unguarded, so it is rejected along with a missing one.
    assert(
        Array.isArray(decisions) && decisions.length > 0,
        'authorize: decisions must be a non-empty array',
    );

    // Copy each decision so a later mutation of the caller's array cannot
    // reshape a gate that is already attached to a route.
    const requiredDecisions = decisions.map((decision, index) => {
        assert(isPlainObject(decision), `authorize: decisions[${ index }] must be a plain object`);
        assertNonEmptyString(decision.action, `authorize: decisions[${ index }].action`);
        assertNonEmptyString(decision.resource, `authorize: decisions[${ index }].resource`);

        return Object.freeze({
            action: decision.action,
            resource: decision.resource,
        });
    });

    assert(
        isUndefined(options) || isPlainObject(options),
        'authorize: options must be a plain object',
    );

    const { message, code } = options ?? {};

    // Only forward keys the caller supplied so ForbiddenError's defaults apply
    // when this route did not override them.
    const errorOptions = {};

    if (!isUndefined(message)) {
        assertNonEmptyString(message, 'authorize: options.message');
        errorOptions.message = message;
    }

    if (!isUndefined(code)) {
        assertNonEmptyString(code, 'authorize: options.code');
        errorOptions.code = code;
    }

    Object.freeze(errorOptions);

    function authorizeMiddleware(context, _request, response) {
        for (const decision of requiredDecisions) {
            requirePermission(context.user, decision, errorOptions);
        }

        return response;
    }

    // Exposed so a test can walk the route manifests and prove every declared
    // decision is reachable by some role. A gate that no role satisfies is
    // dead route, and nothing about it is visible until a request is denied.
    authorizeMiddleware.decisions = Object.freeze(requiredDecisions);

    return authorizeMiddleware;
}
