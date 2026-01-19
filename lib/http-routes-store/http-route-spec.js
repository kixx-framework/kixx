import HttpRoute from '../http-server/http-route.js';
import HttpTargetSpec from './http-target-spec.js';

import {
    isFunction,
    assert,
    assertArray,
    assertFalsy,
    assertNonEmptyString
} from '../assertions/mod.js';

/**
 * @typedef {Array} HandlerDefinition
 * @property {string} 0 - Handler name registered in the middleware or errorHandlers Map
 * @property {Object} [1] - Optional configuration object passed to the handler factory
 */

/**
 * Represents the specification for a single HTTP route, including its pattern, middleware,
 * error handlers, targets, and nested routes. Used to define and validate the structure of
 * a route before it is transformed into an executable HttpRoute instance.
 *
 * Provides utilities for middleware assignment, parent merging, and
 * validation of route specifications.
 */
export default class HttpRouteSpec {

    /**
     * Creates a new HttpRouteSpec instance from a plain object specification.
     *
     * The route specification must provide either nested routes or targets, but not both.
     * Routes define the routing hierarchy (branches), while targets define endpoint handlers (leaves).
     *
     * @param {Object} spec - The route specification object
     * @param {string} [spec.name] - Optional name for the route, defaults to pattern if not provided
     * @param {string} spec.pattern - URL pattern to match against (supports PathToRegexp syntax or '*' wildcard)
     * @param {Array<Function|HandlerDefinition>} [spec.inboundMiddleware=[]] - Inbound middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.outboundMiddleware=[]] - Outbound middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.errorHandlers=[]] - Error handler functions or [name, options] tuples
     * @param {Array<Object>|null} [spec.targets=null] - Array of target specifications for leaf nodes, null for intermediate nodes
     * @param {Array<Object>|null} [spec.routes=null] - Array of nested route specifications for branches, null for leaf nodes
     */
    constructor(spec) {

        Object.defineProperties(this, {
            /**
             * Route identifier used for debugging and logging purposes.
             * @name name
             * @type {string}
             */
            name: {
                value: spec.name,
                enumerable: true,
            },
            /**
             * URL pattern used to match incoming request pathnames.
             * Supports PathToRegexp syntax for parameterized routes or '*' for wildcard matching.
             * @name pattern
             * @type {string}
             */
            pattern: {
                value: spec.pattern,
                enumerable: true,
            },
            /**
             * Middleware functions or [name, options] tuples executed before target handlers.
             * Resolved to middleware functions during route compilation.
             * @name inboundMiddleware
             * @type {Array<Function|HandlerDefinition>}
             */
            inboundMiddleware: {
                value: spec.inboundMiddleware,
                enumerable: true,
            },
            /**
             * Middleware functions or [name, options] tuples executed after target handlers.
             * Resolved to middleware functions during route compilation.
             * @name outboundMiddleware
             * @type {Array<Function|HandlerDefinition>}
             */
            outboundMiddleware: {
                value: spec.outboundMiddleware,
                enumerable: true,
            },
            /**
             * Error handler functions or [name, options] tuples for handling errors in this route.
             * Resolved to error handler functions during route compilation.
             * @name errorHandlers
             * @type {Array<Function|HandlerDefinition>}
             */
            errorHandlers: {
                value: spec.errorHandlers,
                enumerable: true,
            },
            /**
             * Nested route specifications for building route hierarchies.
             * Must be null if targets is provided (routes and targets are mutually exclusive).
             * @name routes
             * @type {Array<HttpRouteSpec>|null}
             */
            routes: {
                value: spec.routes,
                enumerable: true,
            },
            /**
             * Target specifications defining endpoint handlers for this route.
             * Must be null if routes is provided (routes and targets are mutually exclusive).
             * @name targets
             * @type {Array<HttpTargetSpec>|null}
             */
            targets: {
                value: spec.targets,
                enumerable: true,
            },
        });
    }

    /**
     * Resolves middleware and handler definitions by converting [name, options] tuples
     * into actual middleware functions using the provided registries.
     *
     * This method mutates the inboundMiddleware, outboundMiddleware, and errorHandlers arrays
     * by replacing tuple definitions with resolved function references. Functions that are
     * already resolved are left unchanged. Recursively processes nested routes and targets
     * to resolve their middleware definitions as well.
     *
     * @param {Map<string, Function>} middleware - Registry mapping middleware names to factory functions
     * @param {Map<string, Function>} handlers - Registry mapping handler names to factory functions
     * @param {Map<string, Function>} errorHandlers - Registry mapping error handler names to factory functions
     * @param {string} parentName - Parent route identifier used for constructing reporting names
     * @throws {AssertionError} When a middleware name is not found in the middleware registry
     * @throws {AssertionError} When an error handler name is not found in the errorHandlers registry
     */
    assignMiddleware(middleware, handlers, errorHandlers, parentName) {
        // Join name parts using a "/", but remove duplicates (replace "//" with "/").
        const reportingName = `${ parentName }/${ this.name }`.replace(/[/]+/g, '/');

        // Transform middleware references into composed functions
        // [name, options] tuples become actual middleware instances
        for (let i = 0; i < this.inboundMiddleware.length; i += 1) {
            const def = this.inboundMiddleware[i];
            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(middleware.has(name), `Unknown inbound middleware: ${ name } (in route: ${ reportingName })`);
                // Replace the middleware definition with the composed function
                this.inboundMiddleware[i] = composeMiddleware(middleware, def);
            }
        }

        for (let i = 0; i < this.outboundMiddleware.length; i += 1) {
            const def = this.outboundMiddleware[i];
            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(middleware.has(name), `Unknown outbound middleware: ${ name } (in route: ${ reportingName })`);
                // Replace the middleware definition with the composed function
                this.outboundMiddleware[i] = composeMiddleware(middleware, def);
            }
        }

        for (let i = 0; i < this.errorHandlers.length; i += 1) {
            const def = this.errorHandlers[i];
            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(errorHandlers.has(name), `Unknown error handler: ${ name } (in route: ${ reportingName })`);
                this.errorHandlers[i] = composeMiddleware(errorHandlers, def);
            }
        }

        // Recursively assign middleware to nested routes and targets
        if (Array.isArray(this.routes)) {
            for (const route of this.routes) {
                route.assignMiddleware(middleware, handlers, errorHandlers, reportingName);
            }
        }

        if (Array.isArray(this.targets)) {
            for (const target of this.targets) {
                target.assignHandlers(handlers, errorHandlers, reportingName);
            }
        }
    }

    /**
     * Merges this route specification with a parent route specification, combining names, patterns,
     * middleware, and error handlers according to route composition rules.
     *
     * Creates a new HttpRouteSpec instance that represents the child route within the parent's context.
     * Middleware execution order follows a hierarchical pattern: inbound middleware flows parent-to-child
     * (outside-in), while outbound middleware and error handlers flow child-to-parent (inside-out).
     *
     * @param {HttpRouteSpec} parent - Parent route specification to merge with
     * @returns {HttpRouteSpec} New route specification with merged configuration
     */
    mergeParent(parent) {
        // Join name parts using a "/", but remove duplicates (replace "//" with "/").
        const name = `${ parent.name }/${ this.name }`.replace(/[/]+/g, '/');

        let pattern;
        // Wildcard parent patterns should not constrain child patterns
        // This allows mounting entire route trees at any path
        if (parent.pattern === '*') {
            pattern = this.pattern;
        } else {
            // Remove consecutive slashes to handle cases like "/api/" + "/users"
            // Without this, we'd get "/api//users" which breaks path matching
            pattern = (parent.pattern + this.pattern).replace(/\/+/g, '/');
        }

        // Middleware execution order matters for proper request/response flow:
        // Inbound: parent -> child (outside-in) for authentication, parsing, etc.
        const inboundMiddleware = parent.inboundMiddleware.concat(this.inboundMiddleware);

        // Outbound: child -> parent (inside-out) for response transformation
        const outboundMiddleware = this.outboundMiddleware.concat(parent.outboundMiddleware);

        // Error handlers: child -> parent (inside-out) so specific handlers run first
        const errorHandlers = this.errorHandlers.concat(parent.errorHandlers);

        return new HttpRouteSpec({
            name,
            pattern,
            inboundMiddleware,
            outboundMiddleware,
            errorHandlers,
            routes: this.routes,
            targets: this.targets,
        });
    }

    /**
     * Converts this HttpRouteSpec into an HttpRoute instance with compiled pattern matching
     * and resolved target handlers.
     *
     * Compiles the route pattern into a matcher function (using PathToRegexp for parameterized
     * routes or a simple function for wildcard patterns). Transforms all target specifications
     * into executable HttpTarget instances with combined route and virtual host context.
     *
     * @param {import('../http-server/virtual-host.js').default} vhost - The virtual host configuration
     * @returns {import('../http-server/http-route.js').default} The constructed HttpRoute instance ready for request routing
     */
    toHttpRoute(vhost) {
        // Join name parts using a "/", but remove duplicates (replace "//" with "/").
        const name = `${ vhost.name }/${ this.name }`.replace(/[/]+/g, '/');

        const targets = this.targets.map((targetSpec) => {
            return targetSpec.toHttpTarget(vhost, this);
        });

        return new HttpRoute({
            name,
            pattern: this.pattern,
            targets,
            errorHandlers: this.errorHandlers,
        });
    }

    /**
     * Validates a route specification object and creates a new HttpRouteSpec instance.
     *
     * Performs comprehensive validation of route patterns, middleware definitions, and route structure.
     * Validates that the route pattern is either a valid PathToRegexp pattern or the '*' wildcard.
     * Ensures middleware definitions are either functions or properly formatted [name, options] tuples.
     * Validates that routes define either targets (leaf nodes) or nested routes (branches), but not both.
     * Recursively validates nested routes and target specifications.
     *
     * @param {Object} spec - The route specification object to validate
     * @param {string} [spec.name] - Optional route name, defaults to pattern if not provided
     * @param {string} spec.pattern - URL pattern (PathToRegexp syntax or '*' wildcard)
     * @param {Array<Function|HandlerDefinition>} [spec.inboundMiddleware=[]] - Inbound middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.outboundMiddleware=[]] - Outbound middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.errorHandlers=[]] - Error handler functions or [name, options] tuples
     * @param {Array<Object>|null} [spec.routes] - Nested route specifications (mutually exclusive with targets)
     * @param {Array<Object>|null} [spec.targets] - Target specifications (mutually exclusive with routes)
     * @returns {HttpRouteSpec} The validated HttpRouteSpec instance with recursively validated nested structures
     */
    static validateAndCreate(spec) {
        assertNonEmptyString(spec.pattern);

        // Use pattern as name if no explicit name provided
        // This ensures every route has a unique identifier
        const name = spec.name || spec.pattern;

        const inboundMiddleware = spec.inboundMiddleware || [];
        const outboundMiddleware = spec.outboundMiddleware || [];
        const errorHandlers = spec.errorHandlers || [];

        // Validate middleware arrays and their contents
        assertArray(
            inboundMiddleware,
            `route.inboundMiddleware must be an Array (in route: ${ name })`
        );

        assertArray(
            outboundMiddleware,
            `route.outboundMiddleware must be an Array (in route: ${ name })`
        );

        assertArray(
            errorHandlers,
            `route.errorHandlers must be an Array (in route: ${ name })`
        );

        // Middleware can be either a function or [name, options] tuple
        // Tuples allow parameterized middleware instances
        for (const def of inboundMiddleware) {
            if (!isFunction(def)) {
                assertArray(def, `route.inboundMiddleware[] must be an Array (in route: ${ name })`);
                const [ middlewareName ] = def;
                assertNonEmptyString(middlewareName, `route.inboundMiddleware[].name must be a string (in route: ${ name })`);
            }
        }

        for (const def of outboundMiddleware) {
            if (!isFunction(def)) {
                assertArray(def, `route.outboundMiddleware[] must be an Array (in route: ${ name })`);
                const [ middlewareName ] = def;
                assertNonEmptyString(middlewareName, `route.outboundMiddleware[].name must be a string (in route: ${ name })`);
            }
        }

        for (const def of errorHandlers) {
            if (!isFunction(def)) {
                assertArray(def, `route.errorHandlers[] must be an Array (in route: ${ name })`);
                const [ middlewareName ] = def;
                assertNonEmptyString(middlewareName, `route.errorHandlers[].name must be a string (in route: ${ name })`);
            }
        }

        // Routes must define either targets (leaf nodes) or nested routes (branches)
        // Mixing both would create ambiguous routing behavior
        assert(
            spec.routes || spec.targets,
            `route.routes or route.targets are required (in route: ${ name })`
        );

        assertFalsy(
            spec.routes && spec.targets,
            `Cannot define both route.routes AND route.targets (in route: ${ name })`
        );

        let newRoutes = null;
        if (spec.routes) {
            assertArray(spec.routes, `route.routes must be an Array (in route: ${ name })`);
            // Create new array to avoid mutating the original spec
            // Validation process transforms the nested structures
            newRoutes = spec.routes.map((routeSpec) => {
                return this.validateAndCreate(routeSpec);
            });
        }

        let newTargets = null;
        if (spec.targets) {
            assertArray(spec.targets, `route.targets must be an Array (in route: ${ name })`);
            // Create new array to avoid mutating the original spec
            // Validation process transforms the nested structures
            newTargets = spec.targets.map((targetSpec) => {
                return HttpTargetSpec.validateAndCreate(targetSpec, name);
            });
        }

        return new HttpRouteSpec({
            name,
            pattern: spec.pattern,
            inboundMiddleware,
            outboundMiddleware,
            errorHandlers,
            routes: newRoutes,
            targets: newTargets,
        });
    }
}

/**
 * Composes a middleware function from a handler definition tuple using a factory registry.
 *
 * Extracts the handler name and options from a [name, options] tuple, retrieves the
 * factory function from the registry, and invokes it with the provided options to create
 * a configured middleware instance. The factory pattern allows each route to have its own
 * middleware configuration (e.g., different rate limits, auth requirements, or cache settings).
 *
 * @param {Map<string, Function>} middleware - Registry mapping handler names to factory functions
 * @param {HandlerDefinition} def - Handler definition tuple [name, options]
 * @returns {Function} Configured middleware function ready for execution
 */
function composeMiddleware(middleware, def) {
    const [ name, options ] = def;
    const factory = middleware.get(name);
    // Factory pattern allows each route to have its own middleware configuration
    // e.g., different rate limits, auth requirements, or cache settings
    return factory(options || {});
}
