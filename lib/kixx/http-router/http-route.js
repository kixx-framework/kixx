import * as PathToRegexp from '../vendor/path-to-regexp/dist/index.js';
import { ValidationError } from '../errors/mod.js';
import HttpTarget from './http-target.js';
import {
    isFunction,
    isNonEmptyString,
    assertArray,
    assertGreaterThan,
    assertNonEmptyString,
} from '../assertions/mod.js';


/**
 * @typedef {import('./middleware-interface.js').MiddlewareFunction} MiddlewareFunction
 */

/**
 * @typedef {import('./error-handler-interface.js').ErrorHandlerFunction} ErrorHandlerFunction
 */

/**
 * @typedef {import('./server-request-interface.js').ServerRequestInterface} ServerRequestInterface
 */

/**
 * @typedef {import('./server-response.js').default} ServerResponse
 */

/**
 * @typedef {import('./http-target.js').default} HttpTarget
 */


/**
 * Pattern-based pathname routing with middleware targets and error handling.
 *
 * Routes sit between VirtualHost and HttpTarget in the routing hierarchy
 * (Router -> VirtualHost -> Route -> Target). Each route matches URL pathnames
 * using patterns and delegates to targets based on HTTP method. Provides
 * route-level error handling that cascades between target and router levels.
 */
export default class HttpRoute {

    #matchPattern = null;
    #errorHandlers = [];

    /**
     * @param {Object} options - Route configuration
     * @param {string} options.name - Route identifier for debugging and logging
     * @param {string} options.pattern - URL pathname pattern (e.g., '/users/:id') or '*' for catch-all
     * @param {Array<HttpTarget>} options.targets - Targets that handle requests matching this route
     * @param {Array<ErrorHandlerFunction>} options.errorHandlers - Error handlers tried in order until one succeeds
     * @throws {AssertionError} When name or pattern is not a non-empty string, or required arrays are invalid
     */
    constructor(options) {
        const {
            name,
            pattern,
            targets,
            errorHandlers,
        } = options ?? {};

        assertNonEmptyString(name, 'options.name must be a non-empty string');
        assertNonEmptyString(pattern, 'options.pattern must be a non-empty string');
        assertArray(targets, 'options.targets must be an Array');
        assertGreaterThan(0, targets.length, 'options.targets must not be empty');

        const errorHandlerList = errorHandlers ?? [];
        assertArray(errorHandlerList, 'options.errorHandlers must be an Array');

        this.#errorHandlers = errorHandlerList.slice();

        if (pattern === '*') {
            // Wildcard matches everything without regex overhead
            // Simple function returns empty params object for all pathnames
            this.#matchPattern = function match() {
                return { params: {} };
            };
        } else {
            this.#matchPattern = PathToRegexp.match(pattern);
        }

        Object.defineProperties(this, {
            /**
             * Route identifier used in hierarchical target names.
             * @name name
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * URL pathname pattern matched against incoming requests.
             * @name pattern
             * @type {string}
             */
            pattern: {
                enumerable: true,
                value: pattern,
            },
            /**
             * Targets available when this route matches a request pathname.
             * @name targets
             * @type {ReadonlyArray<HttpTarget>}
             */
            targets: {
                enumerable: true,
                value: Object.freeze(targets.slice()),
            },
        });
    }

    /**
     * Aggregates unique HTTP methods supported by all targets on this route
     * @returns {Array<string>} Unique HTTP methods (e.g., ['GET', 'POST'])
     */
    get allowedMethods() {
        const allowedMethods = new Set();

        // Collect methods from all targets
        // A route supports a method if ANY target can handle it
        for (const target of this.targets) {
            for (const method of target.allowedMethods) {
                allowedMethods.add(method);
            }
        }

        return Array.from(allowedMethods);
    }

    /**
     * Tests if a pathname matches this route's pattern and extracts parameters
     * @param {string} pathname - URL pathname to match against route pattern
     * @returns {Object|null} Extracted URL parameters if matched, null otherwise
     */
    matchPathname(pathname) {
        const res = this.#matchPattern(pathname);

        if (res) {
            // Only expose params to maintain abstraction over the internal matcher
            return res.params;
        }

        return null;
    }

    /**
     * Finds the first target that handles the request's HTTP method
     * @param {ServerRequestInterface} request - HTTP request with method property
     * @returns {HttpTarget|null} Matching target or null if no target handles this method
     */
    findTargetForRequest(request) {
        const { method } = request;

        // First match wins - target order matters
        // Targets should be ordered by specificity (authenticated before public)
        for (const target of this.targets) {
            if (target.isMethodAllowed(method)) {
                return target;
            }
        }

        return null;
    }

    /**
     * Attempts to handle an error using route-level error handlers
     *
     * Error handlers are tried in order until one returns a truthy response.
     * This is the second level in the error handling cascade (target -> route -> router).
     *
     * @param {Object} context - Application context with services and configuration
     * @param {ServerRequestInterface} request - HTTP request that triggered the error
     * @param {ServerResponse} response - HTTP response to populate
     * @param {Error} error - The error to handle
     * @returns {Promise<ServerResponse|false>} Response if handled, false to propagate to router-level handlers
     */
    async handleError(context, request, response, error) {
        // Try handlers in order until one successfully handles the error
        // Allows cascading error handling strategies (specific to generic)
        for (const func of this.#errorHandlers) {
            // Sequential execution required - handlers may depend on previous ones
            const newResponse = await func(context, request, response, error);

            if (newResponse) {
                return newResponse;
            }
            // Falsy return signals "try next handler" in the cascade
        }

        // No handler could process this error - propagate to router level
        return false;
    }

    /**
     * Validates a route specification object, checking patterns, middleware, error handlers,
     * and recursing into nested child routes and target specifications.
     *
     * @param {Object} spec - Route specification to validate
     * @param {string} spec.pattern - URL pathname pattern (required)
     * @param {string} [spec.name] - Route name (defaults to pattern)
     * @param {Array<MiddlewareFunction>} [spec.inboundMiddleware] - Inbound middleware functions
     * @param {Array<MiddlewareFunction>} [spec.outboundMiddleware] - Outbound middleware functions
     * @param {Array<ErrorHandlerFunction>} [spec.errorHandlers] - Route-level error handlers
     * @param {Array<Object>} [spec.routes] - Nested child route specifications (mutually exclusive with targets)
     * @param {Array<Object>} [spec.targets] - Target specifications (mutually exclusive with routes)
     * @throws {ValidationError} When specification is invalid
     */
    static validateSpecification(spec) {
        if (!spec || typeof spec !== 'object') {
            throw new ValidationError('A route specification is required and must be an Object');
        }

        if (!isNonEmptyString(spec.pattern)) {
            throw new ValidationError('A route pattern is required and must be a non-empty string');
        }

        // Use pattern as name if no explicit name provided.
        // Uniqueness is the responsibility of the route collection.
        const name = isNonEmptyString(spec.name) ? spec.name : spec.pattern;

        const inboundMiddleware = spec.inboundMiddleware ?? [];
        const outboundMiddleware = spec.outboundMiddleware ?? [];
        const errorHandlers = spec.errorHandlers ?? [];

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

        for (let i = 0; i < inboundMiddleware.length; i += 1) {
            if (!isFunction(inboundMiddleware[ i ])) {
                throw new ValidationError(`route "${ name }" .inboundMiddleware[${ i }] must be a Function`);
            }
        }

        for (let i = 0; i < outboundMiddleware.length; i += 1) {
            if (!isFunction(outboundMiddleware[ i ])) {
                throw new ValidationError(`route "${ name }" .outboundMiddleware[${ i }] must be a Function`);
            }
        }

        for (let i = 0; i < errorHandlers.length; i += 1) {
            if (!isFunction(errorHandlers[ i ])) {
                throw new ValidationError(`route "${ name }" .errorHandlers[${ i }] must be a Function`);
            }
        }

        const hasRoutes = Object.hasOwn(spec, 'routes');
        const hasTargets = Object.hasOwn(spec, 'targets');

        // Routes must define either targets (leaf nodes) or nested routes (branches).
        // Mixing both would create ambiguous routing behavior.
        if (!hasRoutes && !hasTargets) {
            throw new ValidationError(`route.routes or route.targets are required in route "${ name }"`);
        }

        if (hasRoutes && hasTargets) {
            throw new ValidationError(`Cannot define both route.routes AND route.targets in route "${ name }"`);
        }

        if (hasRoutes) {
            if (!Array.isArray(spec.routes)) {
                throw new ValidationError(`route.routes must be an Array in route "${ name }"`);
            }
            if (spec.routes.length === 0) {
                throw new ValidationError(`route.routes must not be empty in route "${ name }"`);
            }
            for (const child of spec.routes) {
                this.validateSpecification(child);
            }
        }

        if (hasTargets) {
            if (!Array.isArray(spec.targets)) {
                throw new ValidationError(`route.targets must be an Array in route "${ name }"`);
            }
            if (spec.targets.length === 0) {
                throw new ValidationError(`route.targets must not be empty in route "${ name }"`);
            }
            for (const targetSpec of spec.targets) {
                HttpTarget.validateSpecification(targetSpec, name);
            }
        }
    }

    /**
     * Builds a leaf HttpRoute from a validated specification, creating HttpTarget
     * instances for each target in the spec.
     *
     * @param {Object} spec - Validated route specification with target definitions
     * @param {string} spec.pattern - URL pathname pattern
     * @param {string} [spec.name] - Route name (defaults to pattern)
     * @param {Array<Object>} spec.targets - Target specification objects
     * @param {Array<MiddlewareFunction>} [spec.inboundMiddleware] - Inbound middleware functions
     * @param {Array<MiddlewareFunction>} [spec.outboundMiddleware] - Outbound middleware functions
     * @param {Array<ErrorHandlerFunction>} [spec.errorHandlers] - Route-level error handlers
     * @returns {HttpRoute} Configured route instance with compiled pattern and targets
     */
    static fromSpecification(spec) {
        assertNonEmptyString(spec.pattern, 'A route specification is expected to have a pattern string');
        assertArray(spec.targets, 'A route specification is expected to have a targets Array');

        // Use pattern as name if no explicit name provided.
        // Uniqueness is the responsibility of the route collection.
        const name = isNonEmptyString(spec.name) ? spec.name : spec.pattern;

        const routeSpec = {
            name,
            pattern: spec.pattern,
            inboundMiddleware: spec.inboundMiddleware ?? [],
            outboundMiddleware: spec.outboundMiddleware ?? [],
        };

        const targets = spec.targets.map((targetSpec) => {
            return HttpTarget.fromSpecification(routeSpec, targetSpec);
        });

        return new HttpRoute({
            name,
            pattern: spec.pattern,
            targets,
            errorHandlers: spec.errorHandlers ?? [],
        });
    }
}
