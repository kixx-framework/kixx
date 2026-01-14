import HttpTarget from './http-target.js';

import {
    isFunction,
    assert,
    assertArray,
    assertNonEmptyString
} from '../assertions/mod.js';

import { HTTP_METHODS } from '../lib/http-utils.js';

/**
 * Represents the specification for a single HTTP target (handler) within a route.
 * Used to define the name, allowed HTTP methods, handler middleware, and error handlers
 * for a target endpoint. Provides validation and transformation utilities for
 * constructing HttpTarget instances from plain object specifications.
 */
export default class HttpTargetSpec {

    constructor(spec) {
        Object.defineProperties(this, {
            /**
             * The name of the target
             * @type {string}
             */
            name: {
                value: spec.name,
                enumerable: true,
            },
            /**
             * The allowed HTTP methods for this target
             * @type {Array<string>}
             */
            methods: {
                value: spec.methods,
                enumerable: true,
            },
            /**
             * The handler middleware for this target
             * @type {Array<Function|HandlerDefinition>}
             */
            handlers: {
                value: spec.handlers,
                enumerable: true,
            },
            /**
             * The error handler middleware for this target
             * @type {Array<Function|HandlerDefinition>}
             */
            errorHandlers: {
                value: spec.errorHandlers,
                enumerable: true,
            },
        });
    }

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
     * route and virtual host context for execution
     *
     * @param {VirtualHost} vhost - The virtual host configuration
     * @param {RouteContext} route - The route configuration with middleware and error handlers
     * @returns {HttpTarget} The constructed HttpTarget instance ready for request handling
     * @throws {TypeError} When vhost or route objects are missing required properties
     */
    toHttpTarget(vhost, route) {
        // Build hierarchical name for debugging and logging purposes
        const name = `${ vhost.name }:${ route.name }:${ this.methods.join(':') }`;
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
     * Validates a target specification object and creates a new HttpTargetSpec instance
     *
     * @param {Object} spec - The target specification object to validate
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
            methods,
            handlers: spec.handlers,
            errorHandlers: spec.errorHandlers || [],
        });
    }
}

function composeMiddleware(middleware, def) {
    const [ name, options ] = def;
    const factory = middleware.get(name);
    // Call factory with options to create the actual middleware function
    return factory(options || {});
}
