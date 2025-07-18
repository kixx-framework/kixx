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


export default class HttpRouteSpec {

    /**
     * Create a new HttpRouteSpec instance from a plain object specification.
     * The specification must include a pattern property and may optionally include:
     * - name: A name for the route (defaults to pattern if not provided)
     * - inboundMiddleware: Array of middleware to execute before target handlers
     * - outboundMiddleware: Array of middleware to execute after target handlers
     * - errorHandlers: Array of error handlers for this route
     * - targets: Array of HttpTarget specifications
     * - routes: Array of HttpRoute specifications
     *
     * The route targets or nested routes must be provided, but not both.
     *
     * @param {Object} spec
     * @param {string} [spec.name] - Optional name for the route
     * @param {string} spec.pattern - URL pattern to match against
     * @param {Array} [spec.inboundMiddleware] - Array of inbound middleware or [name, options] tuples
     * @param {Array} [spec.outboundMiddleware] - Array of outbound middleware or [name, options] tuples
     * @param {Array} [spec.errorHandlers] - Array of error handlers or [name, options] tuples
     * @param {Array} [spec.targets] - Array of target specifications
     * @param {Array} [spec.routes] - Array of route specifications
     */
    constructor(spec) {
        this.name = spec.name;
        this.pattern = spec.pattern;
        this.inboundMiddleware = spec.inboundMiddleware;
        this.outboundMiddleware = spec.outboundMiddleware;
        this.errorHandlers = spec.errorHandlers;
        this.routes = spec.routes;
        this.targets = spec.targets;
    }

    /**
     * Assigns middleware, handlers, and error handlers to this route and its child routes and targets.
     * This method processes inbound middleware, outbound middleware, error handlers, nested routes, and targets.
     * It composes middleware and error handlers from their definitions, and recursively assigns them to child routes and targets.
     *
     * @param {Map<string, Function>} middleware - A map of middleware functions
     * @param {Map<string, Function>} handlers - A map of handler functions
     * @param {Map<string, Function>} errorHandlers - A map of error handler functions
     * @param {string} parentName - The name of the parent route for reporting purposes
     * @param {number} routeIndex - The index of this route within its parent's routes array
     * @throws {AssertionError} If a referenced middleware or error handler is not found in the provided maps
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

        for (let i = 0; i < this.routes.length; i += 1) {
            const route = this.routes[i];
            route.assignMiddleware(middleware, handlers, errorHandlers, reportingName, i);
        }

        for (let i = 0; i < this.targets.length; i += 1) {
            const target = this.targets[i];
            target.assignHandlers(handlers, errorHandlers, `${ reportingName }:target[${ i }]`);
        }
    }

    mergeParent(parent) {
        // Combine the parent and child route names.
        const name = `${ parent.name }:${ this.name }`;

        let pattern;
        // Assume the wildcard pattern matches whatever
        // the child pattern does.
        if (parent.pattern === '*') {
            pattern = this.pattern;
        } else {
            // Concatenate the pattern strings together, and remove any
            // consecutive slashes
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

            // Copy the routes over to a new Array since we're going to be
            // mutating them during the validation process.
            newRoutes = spec.routes.map((routeSpec, i) => {
                newRoutes.push(this.validateAndCreate(routeSpec, reportingName, i));
            });
        }

        let newTargets = null;
        if (spec.targets) {
            assertArray(spec.targets, `route.targets must be an Array (in ${ reportingName })`);

            // Copy the targets over to a new Array since we're going to be
            // mutating them during the validation process.
            newTargets = spec.targets.map((targetSpec, i) => {
                newTargets.push(HttpTargetSpec.validateAndCreate(targetSpec, reportingName, i));
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
