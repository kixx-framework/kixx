import HttpTarget from '../http-server/http-target.js';

import {
    isFunction,
    assert,
    assertArray,
    assertNonEmptyString
} from '../assertions/mod.js';

import { HTTP_METHODS } from '../lib/http-utils.js';

/**
 * @typedef {Array} HandlerDefinition
 * @property {string} 0 - Handler name registered in the handlers or errorHandlers Map
 * @property {Object} [1] - Optional configuration object passed to the handler factory
 */

/**
 * Represents the specification for a single HTTP target (handler) within a route.
 * Used to define the name, allowed HTTP methods, handler middleware, and error handlers
 * for a target endpoint. Provides validation and transformation utilities for
 * constructing HttpTarget instances from plain object specifications.
 */
export default class HttpTargetSpec {

    /**
     * @param {Object} spec - The target specification object
     * @param {string} spec.name - Target identifier used for debugging and logging
     * @param {Array<string>|string} spec.methods - Allowed HTTP methods (e.g., ['GET', 'POST']) or '*' for all methods
     * @param {Array<Function|HandlerDefinition>} spec.handlers - Handler middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.errorHandlers=[]] - Error handler functions or [name, options] tuples
     */
    constructor(spec) {
        Object.defineProperties(this, {
            /**
             * Target identifier used for debugging and logging purposes.
             * @name name
             * @type {string}
             */
            name: {
                value: spec.name,
                enumerable: true,
            },
            /**
             * HTTP methods this target can handle (e.g., ['GET', 'POST']).
             * @name methods
             * @type {Array<string>}
             */
            methods: {
                value: spec.methods,
                enumerable: true,
            },
            /**
             * Handler middleware functions or [name, options] tuples that will be resolved
             * to middleware functions during route compilation.
             * @name handlers
             * @type {Array<Function|HandlerDefinition>}
             */
            handlers: {
                value: spec.handlers,
                enumerable: true,
            },
            /**
             * Error handler functions or [name, options] tuples that will be resolved
             * to error handler functions during route compilation.
             * @name errorHandlers
             * @type {Array<Function|HandlerDefinition>}
             */
            errorHandlers: {
                value: spec.errorHandlers,
                enumerable: true,
            },
        });
    }

    /**
     * Resolves handler and error handler definitions by converting [name, options] tuples
     * into actual middleware functions using the provided handler registries.
     *
     * This method mutates the handlers and errorHandlers arrays by replacing tuple definitions
     * with resolved function references. Functions that are already resolved are left unchanged.
     *
     * @param {Map<string, Function>} handlers - Registry mapping handler names to factory functions
     * @param {Map<string, Function>} errorHandlers - Registry mapping error handler names to factory functions
     * @param {string} reportingName - Route identifier used in error messages for debugging
     * @throws {AssertionError} When a handler name is not found in the handlers registry
     * @throws {AssertionError} When an error handler name is not found in the errorHandlers registry
     */
    assignHandlers(handlers, errorHandlers, reportingName) {
        // Transform handler definitions: convert [name, options] tuples to actual functions
        // while preserving already-resolved function references
        for (let i = 0; i < this.handlers.length; i += 1) {
            const def = this.handlers[i];

            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(handlers.has(name), `Unknown handler: ${ name } (in route: ${ reportingName })`);
                // Replace tuple with composed middleware function
                this.handlers[i] = composeMiddleware(handlers, def);
            }
            // Functions are already resolved, leave them as-is
        }

        // Apply the same transformation process to error handlers
        for (let i = 0; i < this.errorHandlers.length; i += 1) {
            const def = this.errorHandlers[i];

            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(errorHandlers.has(name), `Unknown error handler: ${ name } (in route: ${ reportingName })`);
                // Replace tuple with composed middleware function
                this.errorHandlers[i] = composeMiddleware(errorHandlers, def);
            }
            // Functions are already resolved, leave them as-is
        }
    }

    /**
     * Converts this HttpTargetSpec into an HttpTarget instance with combined
     * route and virtual host context for execution.
     *
     * Combines route-level inbound and outbound middleware with target handlers in the
     * correct execution order (inbound → target → outbound). Target error handlers are
     * prepended to route-level error handlers, allowing endpoint-specific error handling
     * to take precedence.
     *
     * @param {import('../http-server/virtual-host.js').default} vhost - The virtual host configuration
     * @param {import('./http-route-spec.js').default} route - The route specification with middleware and error handlers
     * @returns {HttpTarget} The constructed HttpTarget instance ready for request handling
     */
    toHttpTarget(vhost, route) {
        // Build hierarchical name for debugging and logging purposes
        const name = `${ vhost.name }:${ route.name }:${ this.name }`;
        const allowedMethods = this.methods;

        // Middleware execution order is critical: inbound → target → outbound
        // This ensures proper request preprocessing and response postprocessing
        const middleware = route.inboundMiddleware.concat(this.handlers).concat(route.outboundMiddleware);

        // Target error handlers take precedence over route-level handlers
        // for more specific error handling at the endpoint level
        const errorHandlers = this.errorHandlers.concat(route.errorHandlers);

        return new HttpTarget({
            name,
            allowedMethods,
            middleware,
            errorHandlers,
        });
    }

    /**
     * Validates a target specification object and creates a new HttpTargetSpec instance.
     *
     * Performs comprehensive validation of HTTP methods, handlers, and error handlers.
     * Expands the '*' wildcard to all known HTTP methods. Validates that handler definitions
     * are either functions or properly formatted [name, options] tuples.
     *
     * @param {Object} spec - The target specification object to validate
     * @param {string|Array<string>} spec.methods - HTTP methods array or '*' for all methods
     * @param {Array<Function|HandlerDefinition>} spec.handlers - Handler middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.errorHandlers] - Optional error handler functions or [name, options] tuples
     * @param {string} routeName - The name of the route context for error reporting
     * @returns {HttpTargetSpec} The validated HttpTargetSpec instance
     */
    static validateAndCreate(spec, routeName) {

        // Process HTTP methods: "*" is syntactic sugar for all methods
        let methods;
        if (spec.methods === '*') {
            // Expand wildcard to full HTTP_METHODS array for consistency
            methods = HTTP_METHODS;
        } else {
            methods = spec.methods;
            assertArray(methods, `target.methods must be an Array or "*" (in route: ${ routeName })`);

            // Validate each method against known HTTP methods
            for (const method of methods) {
                assert(HTTP_METHODS.includes(method), `Invalid HTTP method: ${ method } (in route: ${ routeName })`);
            }
        }

        // Validate handlers array and its contents
        assertArray(spec.handlers, `target.handlers must be an Array (in route: ${ routeName })`);

        for (const def of spec.handlers) {
            if (!isFunction(def)) {
                // Handler definition is a [name, options] tuple
                assertArray(def, `target.handlers[] must be an Array (in route: ${ routeName })`);

                const [ handlerName ] = def;

                assertNonEmptyString(handlerName, `target.handlers[].name must be a string (in route: ${ routeName })`);
            }
            // Functions are valid as-is, no further validation needed
        }

        // Error handlers are optional but follow same validation pattern
        if (spec.errorHandlers) {
            assertArray(spec.errorHandlers, `target.errorHandlers must be an Array (in route: ${ routeName })`);

            for (const def of spec.errorHandlers) {
                if (!isFunction(def)) {
                    // Error handler definition is a [name, options] tuple
                    assertArray(def, `target.errorHandlers[] must be an Array (in route: ${ routeName })`);

                    const [ handlerName ] = def;

                    assertNonEmptyString(handlerName, `target.errorHandlers[].name must be a string (in route: ${ routeName })`);
                }
                // Functions are valid as-is, no further validation needed
            }
        }

        return new HttpTargetSpec({
            name: methods.join(':'),
            methods,
            handlers: spec.handlers,
            errorHandlers: spec.errorHandlers || [],
        });
    }
}

/**
 * Composes a middleware function from a handler definition tuple using a factory registry.
 *
 * Extracts the handler name and options from a [name, options] tuple, retrieves the
 * factory function from the registry, and invokes it with the provided options to create
 * a configured middleware instance.
 *
 * @param {Map<string, Function>} middleware - Registry mapping handler names to factory functions
 * @param {HandlerDefinition} def - Handler definition tuple [name, options]
 * @returns {Function} Configured middleware function ready for execution
 */
function composeMiddleware(middleware, def) {
    const [ name, options ] = def;
    const factory = middleware.get(name);
    // Call factory with options to create the actual middleware function
    return factory(options || {});
}
