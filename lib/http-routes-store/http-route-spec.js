import { PathToRegexp } from '../vendor/mod.js';
import { AssertionError } from '../errors/mod.js';
import HttpRoute from './http-route.js';
import HttpTargetSpec from './http-target-spec.js';

import {
    isFunction,
    assert,
    assertArray,
    assertFalsy,
    assertNonEmptyString
} from '../assertions/mod.js';


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
     * Constructs a new HttpRouteSpec instance from a plain object specification.
     *
     * The route specification must provide either nested routes or targets, but not both.
     *
     * @param {Object} spec - The route specification.
     * @param {string} [spec.name] - Optional name for the route.
     * @param {string} spec.pattern - URL pattern to match against.
     * @param {Array} spec.inboundMiddleware - Array of inbound middleware or [name, options] tuples.
     * @param {Array} spec.outboundMiddleware - Array of outbound middleware or [name, options] tuples.
     * @param {Array} spec.errorHandlers - Array of error handlers or [name, options] tuples.
     * @param {Array|null} spec.targets - Array of target specifications. Use null for intermediate nodes.
     * @param {Array|null} spec.routes - Array of route specifications. Use null for leaf nodes.
     */
    constructor(spec) {

        Object.defineProperties(this, {
            /**
             * The name of the route.
             * @type {string}
             */
            name: {
                value: spec.name,
                enumerable: true,
            },
            /**
             * The URL pattern for the route.
             * @type {string}
             */
            pattern: {
                value: spec.pattern,
                enumerable: true,
            },
            /**
             * Array of inbound middleware or [name, options] tuples.
             * @type {Array}
             */
            inboundMiddleware: {
                value: spec.inboundMiddleware,
                enumerable: true,
            },
            /**
             * Array of outbound middleware or [name, options] tuples.
             * @type {Array}
             */
            outboundMiddleware: {
                value: spec.outboundMiddleware,
                enumerable: true,
            },
            /**
             * Array of error handlers or [name, options] tuples.
             * @type {Array}
             */
            errorHandlers: {
                value: spec.errorHandlers,
                enumerable: true,
            },
            /**
             * Array of nested route specifications.
             * @type {Array|null}
             */
            routes: {
                value: spec.routes,
                enumerable: true,
            },
            /**
             * Array of target specifications.
             * @type {Array|null}
             */
            targets: {
                value: spec.targets,
                enumerable: true,
            },
        });
    }

    assignMiddleware(middleware, handlers, errorHandlers, parentName) {
        const reportingName = `${ parentName }:${ this.name }`;

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
     * - The parent route name is joined with the child route name.
     * - The parent pathname pattern is joined with the child pattern. If the parent pattern
     *   is "*" then just the child pattern is used.
     * - Child inboundMiddleware is concatenated onto the parent inboundMiddleware.
     * - Parent outboundMiddleware is concatenated onto the child outboundMiddleware.
     * - Parent errorHandlers are concatenated onto the child errorHandlers.
     */
    mergeParent(parent) {
        const name = `${ parent.name }:${ this.name }`;

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

    toHttpRoute(vhost) {
        const name = `${ vhost.name }:${ this.name }`;

        let patternMatcher;
        if (this.pattern === '*') {
            // Wildcard patterns match everything and don't extract params
            // Using a function instead of PathToRegexp avoids regex overhead
            patternMatcher = function match() {
                return { params: {} };
            };
        } else {
            patternMatcher = PathToRegexp.match(this.pattern);
        }

        const targets = this.targets.map((targetSpec) => {
            return targetSpec.toHttpTarget(vhost, this);
        });

        return new HttpRoute({
            name,
            patternMatcher,
            targets,
            errorHandlers: this.errorHandlers,
        });
    }

    static validateAndCreate(spec) {
        // Validate route pattern
        let pattern;
        if (spec.pattern === '*') {
            pattern = '*';
        } else {
            try {
                // PathToRegexp.match will throw if pattern syntax is invalid
                // Testing here prevents runtime errors when routes are used
                PathToRegexp.match(spec.pattern);
                pattern = spec.pattern;
            } catch (cause) {
                throw new AssertionError(
                    `Invalid route pattern: ${ typeof spec.pattern } ${ spec.pattern } (${ cause.message })`
                );
            }
        }

        // Use pattern as name if no explicit name provided
        // This ensures every route has a unique identifier
        const name = spec.name || pattern;

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
            pattern,
            inboundMiddleware,
            outboundMiddleware,
            errorHandlers,
            routes: newRoutes,
            targets: newTargets,
        });
    }
}

function composeMiddleware(middleware, def) {
    const [ name, options ] = def;
    const factory = middleware.get(name);
    // Factory pattern allows each route to have its own middleware configuration
    // e.g., different rate limits, auth requirements, or cache settings
    return factory(options || {});
}
