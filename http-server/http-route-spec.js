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
 * @class HttpRouteSpec
 * @classdesc
 * Represents the specification for a single HTTP route, including its pattern, middleware, error handlers,
 * targets, and nested routes. Used to define and validate the structure of a route before it is transformed
 * into an executable HttpRoute instance. Provides utilities for middleware assignment, parent merging, and
 * validation of route specifications.
 */
export default class HttpRouteSpec {
    /**
     * Constructs a new HttpRouteSpec instance from a plain object specification.
     *
     * The specification object must include:
     * - pattern: A string pattern for the route (required).
     * - name: (Optional) A name for the route (defaults to pattern if not provided).
     * - inboundMiddleware: (Optional) Array of middleware to execute before target handlers.
     * - outboundMiddleware: (Optional) Array of middleware to execute after target handlers.
     * - errorHandlers: (Optional) Array of error handlers for this route.
     * - targets: (Optional) Array of HttpTarget specifications.
     * - routes: (Optional) Array of nested HttpRoute specifications.
     *
     * Either targets or nested routes must be provided, but not both.
     *
     * @param {Object} spec - The route specification.
     * @param {string} [spec.name] - Optional name for the route.
     * @param {string} spec.pattern - URL pattern to match against.
     * @param {Array} [spec.inboundMiddleware] - Array of inbound middleware or [name, options] tuples.
     * @param {Array} [spec.outboundMiddleware] - Array of outbound middleware or [name, options] tuples.
     * @param {Array} [spec.errorHandlers] - Array of error handlers or [name, options] tuples.
     * @param {Array} [spec.targets] - Array of target specifications.
     * @param {Array} [spec.routes] - Array of route specifications.
     */
    constructor(spec) {
        /**
         * The name of the route.
         * @type {string|undefined}
         */
        this.name = spec.name;

        /**
         * The URL pattern for the route.
         * @type {string}
         */
        this.pattern = spec.pattern;

        /**
         * Array of inbound middleware or [name, options] tuples.
         * @type {Array|undefined}
         */
        this.inboundMiddleware = spec.inboundMiddleware;

        /**
         * Array of outbound middleware or [name, options] tuples.
         * @type {Array|undefined}
         */
        this.outboundMiddleware = spec.outboundMiddleware;

        /**
         * Array of error handlers or [name, options] tuples.
         * @type {Array|undefined}
         */
        this.errorHandlers = spec.errorHandlers;

        /**
         * Array of nested route specifications.
         * @type {Array|undefined}
         */
        this.routes = spec.routes;

        /**
         * Array of target specifications.
         * @type {Array|undefined}
         */
        this.targets = spec.targets;
    }

    /**
     * Assigns middleware, handlers, and error handlers to this route and its child routes and targets.
     * This method processes inbound middleware, outbound middleware, error handlers, nested routes, and targets.
     * It composes middleware and error handlers from their definitions, and recursively assigns them to child routes and targets.
     *
     * @param {Map<string, Function>} middleware - A map of middleware functions.
     * @param {Map<string, Function>} handlers - A map of handler functions.
     * @param {Map<string, Function>} errorHandlers - A map of error handler functions.
     * @param {string} parentName - The name of the parent route for reporting purposes.
     * @param {number} routeIndex - The index of this route within its parent's routes array.
     * @throws {AssertionError} If a referenced middleware or error handler is not found in the provided maps.
     */
    assignMiddleware(middleware, handlers, errorHandlers, parentName, routeIndex) {
        const reportingName = `${ parentName }[${ routeIndex }]:${ this.name }`;

        for (let i = 0; i < this.inboundMiddleware.length; i += 1) {
            const def = this.inboundMiddleware[i];
            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(middleware.has(name), `Unknown inbound middleware: ${ name } (in ${ reportingName })`);
                this.inboundMiddleware[i] = composeMiddleware(middleware, def);
            }
        }

        for (let i = 0; i < this.outboundMiddleware.length; i += 1) {
            const def = this.outboundMiddleware[i];
            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(middleware.has(name), `Unknown outbound middleware: ${ name } (in ${ reportingName })`);
                this.outboundMiddleware[i] = composeMiddleware(middleware, def);
            }
        }

        for (let i = 0; i < this.errorHandlers.length; i += 1) {
            const def = this.errorHandlers[i];
            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(errorHandlers.has(name), `Unknown error handler: ${ name } (in ${ reportingName })`);
                this.errorHandlers[i] = composeMiddleware(errorHandlers, def);
            }
        }

        if (Array.isArray(this.routes)) {
            for (let i = 0; i < this.routes.length; i += 1) {
                const route = this.routes[i];
                route.assignMiddleware(middleware, handlers, errorHandlers, reportingName, i);
            }
        }

        if (Array.isArray(this.targets)) {
            for (let i = 0; i < this.targets.length; i += 1) {
                const target = this.targets[i];
                target.assignHandlers(handlers, errorHandlers, `${ reportingName }:target[${ i }]`);
            }
        }
    }

    /**
     * Merges this route specification with a parent route specification, combining names, patterns,
     * middleware, and error handlers according to route composition rules.
     *
     * @param {HttpRouteSpec} parent - The parent route specification.
     * @returns {HttpRouteSpec} A new HttpRouteSpec instance representing the merged route.
     */
    mergeParent(parent) {
        // Combine the parent and child route names.
        const name = `${ parent.name }:${ this.name }`;

        let pattern;
        // If the parent pattern is a wildcard, use the child pattern.
        if (parent.pattern === '*') {
            pattern = this.pattern;
        } else {
            // Concatenate the pattern strings together, and remove any consecutive slashes.
            pattern = (parent.pattern + this.pattern).replace(/\/+/g, '/');
        }

        // Inbound middleware is invoked from the outside in.
        const inboundMiddleware = parent.inboundMiddleware.concat(this.inboundMiddleware);

        // Outbound middleware is invoked from the inside out.
        const outboundMiddleware = this.outboundMiddleware.concat(parent.outboundMiddleware);

        // Error handlers are invoked from the inside out.
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
     * Converts this route specification into an executable HttpRoute instance for the given virtual host.
     *
     * @param {Object} vhost - The virtual host context.
     * @returns {HttpRoute} The constructed HttpRoute instance.
     */
    toHttpRoute(vhost) {
        const name = `${ vhost.name }:${ this.name }`;

        let patternMatcher;
        if (this.pattern === '*') {
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

    /**
     * Validates a plain route specification object and returns a new HttpRouteSpec instance.
     * Performs type checks, pattern validation, and ensures that either targets or nested routes are provided (but not both).
     *
     * @param {Object} spec - The route specification object.
     * @param {string} parentName - The name of the parent route for reporting purposes.
     * @param {number} routeIndex - The index of this route within its parent's routes array.
     * @returns {HttpRouteSpec} The validated and constructed HttpRouteSpec instance.
     * @throws {AssertionError} If validation fails.
     */
    static validateAndCreate(spec, parentName, routeIndex) {
        let reportingName = spec.name
            ? `${ parentName }[${ routeIndex }]:${ spec.name }`
            : `${ parentName }[${ routeIndex }]`;

        const inboundMiddleware = spec.inboundMiddleware || [];
        const outboundMiddleware = spec.outboundMiddleware || [];
        const errorHandlers = spec.errorHandlers || [];

        let pattern;
        if (spec.pattern === '*') {
            pattern = '*';
        } else {
            try {
                PathToRegexp.match(spec.pattern);
                pattern = spec.pattern;
            } catch (cause) {
                throw new AssertionError(
                    `Invalid route pattern: ${ typeof spec.pattern } ${ spec.pattern } in ${ reportingName }`,
                    { cause }
                );
            }
        }

        const name = spec.name || pattern;

        reportingName = `${ parentName }[${ routeIndex }]:${ name }`;

        assertArray(
            inboundMiddleware,
            `route.inboundMiddleware must be an Array (in ${ reportingName })`
        );

        assertArray(
            outboundMiddleware,
            `route.outboundMiddleware must be an Array (in ${ reportingName })`
        );

        assertArray(
            errorHandlers,
            `route.errorHandlers must be an Array (in ${ reportingName })`
        );

        for (const def of inboundMiddleware) {
            if (!isFunction(def)) {
                assertArray(def, `route.inboundMiddleware[] must be an Array (in ${ reportingName })`);
                const [ middlewareName ] = def;
                assertNonEmptyString(middlewareName, `route.inboundMiddleware[].name must be a string (in ${ reportingName })`);
            }
        }

        for (const def of outboundMiddleware) {
            if (!isFunction(def)) {
                assertArray(def, `route.outboundMiddleware[] must be an Array (in ${ reportingName })`);
                const [ middlewareName ] = def;
                assertNonEmptyString(middlewareName, `route.outboundMiddleware[].name must be a string (in ${ reportingName })`);
            }
        }

        for (const def of errorHandlers) {
            if (!isFunction(def)) {
                assertArray(def, `route.errorHandlers[] must be an Array (in ${ reportingName })`);
                const [ middlewareName ] = def;
                assertNonEmptyString(middlewareName, `route.errorHandlers[].name must be a string (in ${ reportingName })`);
            }
        }

        assert(
            spec.routes || spec.targets,
            `route.routes or route.targets are required (in ${ reportingName })`
        );

        assertFalsy(
            spec.routes && spec.targets,
            `Cannot define both route.routes AND route.targets (in ${ reportingName })`
        );

        let newRoutes = null;
        if (spec.routes) {
            assertArray(spec.routes, `route.routes must be an Array (in ${ reportingName })`);
            // Copy the routes over to a new Array since we're going to be mutating them during the validation process.
            newRoutes = spec.routes.map((routeSpec, i) => {
                return this.validateAndCreate(routeSpec, reportingName, i);
            });
        }

        let newTargets = null;
        if (spec.targets) {
            assertArray(spec.targets, `route.targets must be an Array (in ${ reportingName })`);
            // Copy the targets over to a new Array since we're going to be mutating them during the validation process.
            newTargets = spec.targets.map((targetSpec, i) => {
                return HttpTargetSpec.validateAndCreate(targetSpec, reportingName, i);
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
    return factory(options);
}
