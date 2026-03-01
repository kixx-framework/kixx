import { ValidationError } from '../errors.js';
import {
    isFunction,
    isNonEmptyString
} from '../assertions.js';

import HttpTargetSpec from './http-target-spec.js';

/**
 * A [name, options] tuple referencing a named middleware or handler with optional configuration.
 * Named references are resolved to functions during route compilation.
 * @typedef {Array} HandlerDefinition
 * @property {string} 0 - Registered middleware or handler name
 * @property {Object} [1] - Options passed to the middleware or handler factory
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
     * @param {Object} spec - The route specification object
     * @param {string} [spec.name] - Optional name for the route, defaults to pattern if not provided
     * @param {string} spec.pattern - URL pattern to match against (supports PathToRegexp syntax or '*' wildcard)
     * @param {Array<Function|Array>} [spec.inboundMiddleware=[]] - Inbound middleware functions or [name, options] tuples
     * @param {Array<Function|Array>} [spec.outboundMiddleware=[]] - Outbound middleware functions or [name, options] tuples
     * @param {Array<Function|Array>} [spec.errorHandlers=[]] - Error handler functions or [name, options] tuples
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
        if (!isNonEmptyString(spec.pattern)) {
            throw new ValidationError('A route pattern is required and must be a non-empty string');
        }

        // Use pattern as name if no explicit name provided
        // This ensures every route has a unique identifier
        const name = isNonEmptyString(spec.name) ? spec.name : spec.pattern;

        const inboundMiddleware = spec.inboundMiddleware || [];
        const outboundMiddleware = spec.outboundMiddleware || [];
        const errorHandlers = spec.errorHandlers || [];

        // Validate middleware arrays and their contents
        if (!Array.isArray(inboundMiddleware)) {
            throw new ValidationError(`route "${ name }" .inboundMiddleware must be an Array`);
        }

        if (!Array.isArray(outboundMiddleware)) {
            throw new ValidationError(`route "${ name }" .outboundMiddleware must be an Array`);
        }

        if (!Array.isArray(errorHandlers)) {
            throw new ValidationError(`route "${ name }" .errorHandlers must be an Array`);
        }

        // Middleware can be either a function or [name, options] tuple
        // Tuples allow parameterized middleware instances
        for (let i = 0; i < inboundMiddleware.length; i += 1) {
            const def = inboundMiddleware[ i ];
            if (!isFunction(def)) {
                if (!Array.isArray(def)) {
                    throw new ValidationError(`route "${ name }" .inboundMiddleware[${ i }] must be an Array`);
                }
                const [ middlewareName ] = def;
                if (!isNonEmptyString(middlewareName)) {
                    throw new ValidationError(`route "${ name }" .inboundMiddleware[${ i }][0] must be a string`);
                }
            }
        }

        for (let i = 0; i < outboundMiddleware.length; i += 1) {
            const def = outboundMiddleware[ i ];
            if (!isFunction(def)) {
                if (!Array.isArray(def)) {
                    throw new ValidationError(`route "${ name }" .outboundMiddleware[${ i }] must be an Array`);
                }
                const [ middlewareName ] = def;
                if (!isNonEmptyString(middlewareName)) {
                    throw new ValidationError(`route "${ name }" .outboundMiddleware[${ i }][0] must be a string`);
                }
            }
        }

        for (let i = 0; i < errorHandlers.length; i += 1) {
            const def = errorHandlers[ i ];
            if (!isFunction(def)) {
                if (!Array.isArray(def)) {
                    throw new ValidationError(`route "${ name }" .errorHandlers[${ i }] must be an Array`);
                }
                const [ middlewareName ] = def;
                if (!isNonEmptyString(middlewareName)) {
                    throw new ValidationError(`route "${ name }" .errorHandlers[${ i }][0] must be a string`);
                }
            }
        }

        // Routes must define either targets (leaf nodes) or nested routes (branches)
        // Mixing both would create ambiguous routing behavior
        if (!spec.routes && !spec.targets) {
            throw new ValidationError(`route.routes or route.targets are required in route "${ name }"`);
        }

        if (spec.routes && spec.targets) {
            throw new ValidationError(`Cannot define both route.routes AND route.targets in route "${ name }"`);
        }

        let newRoutes = null;
        if (spec.routes) {
            if (!Array.isArray(spec.routes)) {
                throw new ValidationError(`route.routes must be an Array in route "${ name }"`);
            }
            // Transform each plain object into a validated HttpRouteSpec instance
            newRoutes = spec.routes.map((routeSpec) => {
                return this.validateAndCreate(routeSpec);
            });
        }

        let newTargets = null;
        if (spec.targets) {
            if (!Array.isArray(spec.targets)) {
                throw new ValidationError(`route.targets must be an Array in route "${ name }"`);
            }
            // Transform each plain object into a validated HttpTargetSpec instance
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
