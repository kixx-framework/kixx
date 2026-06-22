import * as PathToRegexp from '../vendor/path-to-regexp/dist/index.js';
import { ValidationError } from '../errors/mod.js';
import {
    isFunction,
    isNonEmptyString,
    assertArray,
    assertGreaterThan,
    assertNonEmptyString,
} from '../assertions/mod.js';


const HTTP_METHODS = 'GET HEAD POST PUT PATCH DELETE'.split(' ');


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
 * HTTP endpoint handler with chained middleware and cascading error handling.
 *
 * Targets are the leaf nodes in the routing hierarchy (Router -> VirtualHost -> Route -> Target).
 * Each target handles specific HTTP methods and executes a middleware chain to process requests.
 * Error handling cascades from target to route to router level, allowing specific error responses
 * at each layer.
 */
export default class HttpTarget {

    #pattern = null;
    #middleware = [];
    #errorHandlers = [];

    /**
     * @param {Object} options - Target configuration
     * @param {string} options.name - Target identifier used for debugging and logging
     * @param {string} options.pattern - URL pathname pattern from the parent route (e.g., '/users/:id')
     * @param {Array<string>} options.allowedMethods - HTTP methods this target handles (e.g., ['GET', 'POST'])
     * @param {Array<string>} [options.tags=[]] - Tags for categorizing and filtering targets
     * @param {Array<MiddlewareFunction>} [options.middleware=[]] - Middleware functions executed in order
     * @param {Array<ErrorHandlerFunction>} [options.errorHandlers=[]] - Error handlers tried in order until one succeeds
     * @throws {AssertionError} When name or pattern is not a non-empty string, or required arrays are invalid
     */
    constructor(options) {
        const optionBag = options ?? {};
        const {
            name,
            pattern,
            allowedMethods,
            middleware,
            errorHandlers,
        } = optionBag;

        assertNonEmptyString(name, 'options.name must be a non-empty string');
        assertNonEmptyString(pattern, 'options.pattern must be a non-empty string');
        assertArray(allowedMethods, 'options.allowedMethods must be an Array');
        assertGreaterThan(0, allowedMethods.length, 'options.allowedMethods must not be empty');

        const middlewareList = middleware ?? [];
        const errorHandlerList = errorHandlers ?? [];
        const tags = Array.isArray(optionBag.tags) ? optionBag.tags.slice() : [];

        assertArray(middlewareList, 'options.middleware must be an Array');
        assertArray(errorHandlerList, 'options.errorHandlers must be an Array');

        this.#pattern = pattern;
        this.#middleware = middlewareList;
        this.#errorHandlers = errorHandlerList;

        Object.defineProperties(this, {
            /**
             * Target identifier used for debugging and logging
             * @name name
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * HTTP methods this target handles
             * @name allowedMethods
             * @type {ReadonlyArray<string>}
             */
            allowedMethods: {
                enumerable: true,
                value: Object.freeze(allowedMethods.slice()),
            },
            /**
             * Tags for categorizing and filtering targets
             * @name tags
             * @type {ReadonlyArray<string>}
             */
            tags: {
                enumerable: true,
                value: Object.freeze(tags),
            },
        });
    }

    /**
     * Reports whether this target declares the given tag.
     * @param {string} tag
     * @returns {boolean}
     */
    hasTag(tag) {
        return this.tags.includes(tag);
    }

    /**
     * Reports whether this target handles the given HTTP method.
     * @param {string} method - Uppercase HTTP method name (e.g., 'GET', 'POST')
     * @returns {boolean}
     */
    isMethodAllowed(method) {
        return this.allowedMethods.includes(method);
    }

    /**
     * Executes the middleware chain for this target.
     *
     * Middleware are invoked sequentially, and each one's return value is
     * threaded in as the `response` argument to the next. A middleware that
     * returns a nullish value leaves the current response in place, so handlers
     * that mutate the shared response without returning it still work. Each
     * receives a `skip` callback that, when called, halts the chain after the
     * current middleware. With no middleware, the passed-in response is
     * returned unchanged.
     *
     * @param {Object} context - Application context with services and configuration
     * @param {ServerRequestInterface} request - Incoming HTTP request with resolved route parameters
     * @param {ServerResponse} response - Initial HTTP response to populate
     * @returns {Promise<ServerResponse>} The response after the last middleware to run
     */
    async invokeMiddleware(context, request, response) {
        let done = false;

        function skip() {
            done = true;
        }

        for (const func of this.#middleware) {
            // Thread each middleware's result into the next invocation. A nullish
            // return keeps the current response, so handlers that mutate the
            // shared response in place without returning it still work.
            response = (await func(context, request, response, skip)) ?? response;

            if (done) {
                return response;
            }
        }

        return response;
    }

    /**
     * Attempts to handle an error using this target's error handlers.
     *
     * Error handlers are tried in order until one returns a truthy response.
     * This is the first level in the error handling cascade (target -> route -> router).
     *
     * @param {Object} context - Application context with services and configuration
     * @param {ServerRequestInterface} request - Incoming HTTP request
     * @param {ServerResponse} response - HTTP response to populate
     * @param {Error} error - The error to handle
     * @returns {Promise<ServerResponse|false>} Response if handled, false to propagate to route-level handlers
     */
    async handleError(context, request, response, error) {
        for (const func of this.#errorHandlers) {
            const newResponse = await func(context, request, response, error);

            if (newResponse) {
                return newResponse;
            }
        }

        return false;
    }

    /**
     * Reverse constructs the pathname and preferred HTTP method for this target.
     *
     * Takes pathname parameters and compiles them into a concrete pathname using
     * the route pattern, then selects the preferred HTTP method for this target.
     *
     * @param {Object} params - Pathname parameters to substitute into the pattern
     * @returns {{method: string, pathname: string}} The preferred method and compiled pathname
     * @throws {Error} When target uses wildcard pattern (cannot be reversed)
     */
    compilePathname(params) {
        if (this.#pattern === '*') {
            throw new Error('Cannot compile pathname for wildcard route pattern');
        }

        const compilePath = PathToRegexp.compile(this.#pattern);
        const pathname = compilePath(params || {});

        // Priority favors idempotent read methods: GET > POST > PUT > PATCH > DELETE > HEAD
        const methodPriority = [ 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD' ];
        let method = this.allowedMethods[0];

        for (const preferredMethod of methodPriority) {
            if (this.allowedMethods.includes(preferredMethod)) {
                method = preferredMethod;
                break;
            }
        }

        return { method, pathname };
    }

    /**
     * Validates a target specification against the expected schema, checking name,
     * HTTP methods, tags, request handlers, and error handlers.
     *
     * @param {Object} spec - Target specification to validate
     * @param {string} spec.name - Target name (required)
     * @param {Array<string>|string} spec.methods - HTTP methods or '*' for all methods
     * @param {Array<string>} [spec.tags] - Tags for categorizing targets
     * @param {Array<MiddlewareFunction>} spec.requestHandlers - Request handler functions
     * @param {Array<ErrorHandlerFunction>} [spec.errorHandlers] - Error handler functions
     * @param {string} routeName - Parent route name for error messages
     * @throws {ValidationError} When specification is invalid
     */
    static validateSpecification(spec, routeName) {

        // Missing routeName is a programmer error (wrong call site), not a bad spec.
        assertNonEmptyString(routeName, 'routeName must be a non-empty string');

        if (!isNonEmptyString(spec.name)) {
            throw new ValidationError(`target.name is required and must be a non-empty string (in route: ${ routeName })`);
        }

        if (spec.methods !== '*') {
            if (!Array.isArray(spec.methods)) {
                throw new ValidationError(`${ routeName } target "${ spec.name }" .methods must be an Array or "*"`);
            }

            for (const method of spec.methods) {
                if (!HTTP_METHODS.includes(method)) {
                    throw new ValidationError(`${ routeName } target "${ spec.name }" has an invalid HTTP method: ${ method }`);
                }
            }
        }

        if (spec.tags) {
            if (!Array.isArray(spec.tags)) {
                throw new ValidationError(`${ routeName } target "${ spec.name }" .tags must be an Array`);
            }

            for (const tag of spec.tags) {
                if (!isNonEmptyString(tag)) {
                    throw new ValidationError(`${ routeName } target "${ spec.name }" .tags[] must only contain non-empty strings`);
                }
            }
        }

        if (!Array.isArray(spec.requestHandlers)) {
            throw new ValidationError(`${ routeName } target "${ spec.name }" .requestHandlers must be an Array`);
        }

        for (let i = 0; i < spec.requestHandlers.length; i += 1) {
            if (!isFunction(spec.requestHandlers[ i ])) {
                throw new ValidationError(`${ routeName } target "${ spec.name }" .requestHandlers[${ i }] must be a Function`);
            }
        }

        if (spec.errorHandlers) {
            if (!Array.isArray(spec.errorHandlers)) {
                throw new ValidationError(`${ routeName } target "${ spec.name }" .errorHandlers must be an Array`);
            }

            for (let i = 0; i < spec.errorHandlers.length; i += 1) {
                if (!isFunction(spec.errorHandlers[ i ])) {
                    throw new ValidationError(`${ routeName } target "${ spec.name }" .errorHandlers[${ i }] must be a Function`);
                }
            }
        }
    }

    /**
     * Builds an HttpTarget from route and target specifications.
     *
     * Produces hierarchical names (routeName/targetName), and assembles the full middleware
     * chain by merging route-level inbound middleware, target handlers, and route-level
     * outbound middleware in that order. Error handling cascades from target to route to
     * router — it is not merged here.
     *
     * @param {Object} routeSpec - Parent route specification
     * @param {string} routeSpec.name - Route name for hierarchical target naming
     * @param {string} routeSpec.pattern - Pathname pattern from the route
     * @param {Array<MiddlewareFunction>} routeSpec.inboundMiddleware - Middleware before target handlers
     * @param {Array<MiddlewareFunction>} routeSpec.outboundMiddleware - Middleware after target handlers
     * @param {Object} targetSpec - Target specification
     * @param {string} targetSpec.name - Target name for hierarchical naming
     * @param {Array<string>} targetSpec.methods - HTTP methods this target handles
     * @param {Array<string>} [targetSpec.tags] - Tags for categorizing targets
     * @param {Array<MiddlewareFunction>} targetSpec.requestHandlers - Target handler middleware
     * @param {Array<ErrorHandlerFunction>} targetSpec.errorHandlers - Target-level error handlers
     * @returns {HttpTarget} Configured target instance
     */
    static fromSpecification(routeSpec, targetSpec) {
        assertNonEmptyString(routeSpec.name, 'routeSpec.name must be a non-empty string');
        assertArray(routeSpec.inboundMiddleware, 'routeSpec.inboundMiddleware must be an Array');
        assertArray(routeSpec.outboundMiddleware, 'routeSpec.outboundMiddleware must be an Array');
        assertNonEmptyString(targetSpec.name, 'targetSpec.name must be a non-empty string');
        assertArray(targetSpec.requestHandlers, 'targetSpec.requestHandlers must be an Array');
        const errorHandlers = targetSpec.errorHandlers ?? [];

        assertArray(errorHandlers, 'targetSpec.errorHandlers must be an Array');

        // Collapse any double-slashes that arise when route or target names contain leading/trailing slashes.
        const name = `${ routeSpec.name }/${ targetSpec.name }`.replace(/[/]+/g, '/');

        const methods = targetSpec.methods === '*' ? HTTP_METHODS : targetSpec.methods;

        // Execution order: inbound → target handlers → outbound
        const middleware = routeSpec.inboundMiddleware.concat(targetSpec.requestHandlers).concat(routeSpec.outboundMiddleware);

        return new HttpTarget({
            name,
            pattern: routeSpec.pattern,
            allowedMethods: methods,
            tags: targetSpec.tags,
            middleware,
            errorHandlers,
        });
    }
}
