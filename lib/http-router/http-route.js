import { PathToRegexp } from '../vendor/mod.js';
import { AssertionError } from '../errors.js';
import {
    assertArray,
    assertGreaterThan,
    assertNonEmptyString
} from '../assertions.js';
import HttpTarget from './http-target.js';


/**
 * Pattern-based pathname routing with middleware targets and error handling.
 *
 * Routes sit between VirtualHost and HttpTarget in the routing hierarchy
 * (Router -> VirtualHost -> Route -> Target). Each route matches URL pathnames
 * using patterns and delegates to targets based on HTTP method. Provides
 * route-level error handling that cascades between target and router levels.
 */
export default class HttpRoute {

    /**
     * Pattern matcher function that extracts URL parameters from pathname
     * @type {Function}
     */
    #matchPattern = null;

    /**
     * Error handlers tried in order until one returns a response
     * @type {Array<Function>}
     */
    #errorHandlers = [];

    /**
     * @param {Object} options - Route configuration
     * @param {string} options.name - Route identifier for debugging and logging
     * @param {string} options.pattern - URL pathname pattern (e.g., '/users/:id') or '*' for catch-all
     * @param {Array<HttpTarget>} options.targets - Targets that handle requests matching this route
     * @param {Array<Function>} options.errorHandlers - Error handlers tried in order until one succeeds
     */
    constructor(options) {
        const {
            name,
            pattern,
            targets,
            errorHandlers,
        } = options;

        assertNonEmptyString(name, 'options.name must be a non-empty string');
        assertNonEmptyString(pattern, 'options.pattern must be a non-empty string');
        assertArray(targets, 'options.targets must be an Array');
        assertGreaterThan(0, targets.length, 'options.targets must not be empty');

        this.#errorHandlers = Array.isArray(errorHandlers) ? errorHandlers : [];

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
             * Route identifier for debugging and logging
             * @name name
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * Targets that handle requests matching this route
             * @name targets
             * @type {Array<HttpTarget>}
             */
            targets: {
                enumerable: true,
                value: targets,
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
     * @param {HttpServerRequest} request - HTTP request with method property
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
     * @async
     * @param {Object} context - Application context with services and configuration
     * @param {HttpServerRequest} request - HTTP request that triggered the error
     * @param {HttpServerResponse} response - HTTP response to populate
     * @param {Error} error - The error to handle
     * @returns {Promise<HttpServerResponse|false>} Response if handled, false to propagate to router-level handlers
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
     * Builds an HttpRoute from a specification object.
     * @param {Object} routeSpec - Route specification
     * @param {string} routeSpec.name - Route identifier
     * @param {string} routeSpec.pattern - URL pathname pattern or '*' for catch-all
     * @param {Array<Object>} routeSpec.inboundMiddleware - Inbound middleware specifications
     * @param {Array<Object>} routeSpec.outboundMiddleware - Outbound middleware specifications
     * @param {Array<Object>} routeSpec.targets - Target specifications to convert
     * @param {Map<string, Function>} middleware - Middleware registry
     * @param {Map<string, Function>} requestHandlers - Request Handlers registry
     * @param {Map<string, Function>} errorHandlers - Error Handlers registry
     * @returns {HttpRoute} Configured route instance
     */
    static fromSpecification(routeSpec, middleware, requestHandlers, errorHandlers) {
        const { name, pattern } = routeSpec;

        // Transform middleware references into composed functions
        // [name, options] tuples become actual middleware instances
        const inboundMiddleware = [];
        for (let i = 0; i < routeSpec.inboundMiddleware.length; i += 1) {
            const def = routeSpec.inboundMiddleware[i];
            if (Array.isArray(def)) {
                const [ middlewareName, options ] = def;
                if (!middleware.has(middlewareName)) {
                    throw new AssertionError(`Unknown inbound middleware: ${ middlewareName } (in route: ${ name })`);
                }
                // Replace the middleware definition with the composed function
                const factory = middleware.get(middlewareName);
                const fn = factory(options || {});
                inboundMiddleware.push(fn);
            } else {
                // Assume the definition is already a function
                inboundMiddleware.push(def);
            }
        }

        // Transform middleware references into composed functions
        // [name, options] tuples become actual middleware instances
        const outboundMiddleware = [];
        for (let i = 0; i < routeSpec.outboundMiddleware.length; i += 1) {
            const def = routeSpec.outboundMiddleware[i];
            if (Array.isArray(def)) {
                const [ middlewareName, options ] = def;
                if (!middleware.has(middlewareName)) {
                    throw new AssertionError(`Unknown outbound middleware: ${ middlewareName } (in route: ${ name })`);
                }
                const factory = middleware.get(middlewareName);
                const fn = factory(options || {});
                outboundMiddleware.push(fn);
            } else {
                // Assume the definition is already a function
                outboundMiddleware.push(def);
            }
        }

        // Transform error handler references into composed functions
        // [name, options] tuples become actual error handler instances
        const routeErrorHandlers = [];
        for (let i = 0; i < routeSpec.errorHandlers.length; i += 1) {
            const def = routeSpec.errorHandlers[i];
            if (Array.isArray(def)) {
                const [ errorHandlerName, options ] = def;
                if (!errorHandlers.has(errorHandlerName)) {
                    throw new AssertionError(`Unknown error handler: ${ errorHandlerName } (in route: ${ name })`);
                }
                const factory = errorHandlers.get(errorHandlerName);
                const fn = factory(options || {});
                routeErrorHandlers.push(fn);
            } else {
                // Assume the definition is already a function
                routeErrorHandlers.push(def);
            }
        }

        // Create a new route specification object specifying the hydrated middleware and
        // error handlers for the targets.
        const spec = {
            name,
            pattern,
            inboundMiddleware,
            outboundMiddleware,
            errorHandlers: routeErrorHandlers,
        };

        const targets = routeSpec.targets.map((targetSpec) => {

            // Transform middleware references into composed functions
            // [name, options] tuples become actual middleware instances
            const handlers = [];
            for (let i = 0; i < targetSpec.handlers.length; i += 1) {
                const def = targetSpec.handlers[i];
                if (Array.isArray(def)) {
                    const [ handlerName, options ] = def;
                    if (!requestHandlers.has(handlerName)) {
                        throw new AssertionError(`Unknown request handler: ${ handlerName } (in target: ${ targetSpec.name })`);
                    }
                    const factory = requestHandlers.get(handlerName);
                    const fn = factory(options || {});
                    handlers.push(fn);
                } else {
                    // Assume the definition is already a function
                    handlers.push(def);
                }
            }

            // Transform error handler references into composed functions
            // [name, options] tuples become actual error handler instances
            const targetErrorHandlers = [];
            for (let i = 0; i < targetSpec.errorHandlers.length; i += 1) {
                const def = targetSpec.errorHandlers[i];
                if (Array.isArray(def)) {
                    const [ errorHandlerName, options ] = def;
                    if (!errorHandlers.has(errorHandlerName)) {
                        throw new AssertionError(`Unknown error handler: ${ errorHandlerName } (in target: ${ targetSpec.name })`);
                    }
                    const factory = errorHandlers.get(errorHandlerName);
                    const fn = factory(options || {});
                    targetErrorHandlers.push(fn);
                } else {
                    // Assume the definition is already a function
                    targetErrorHandlers.push(def);
                }
            }

            const newTargetSpec = {
                name: targetSpec.name,
                methods: targetSpec.methods,
                tags: targetSpec.tags,
                handlers,
                errorHandlers: targetErrorHandlers,
            };

            return HttpTarget.fromSpecification(spec, newTargetSpec);
        });

        return new HttpRoute({
            name,
            pattern,
            targets,
            errorHandlers: routeErrorHandlers,
        });
    }
}
