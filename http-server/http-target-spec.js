/**
 * @fileoverview HTTP target specification and validation utilities
 * 
 * This module provides the HttpTargetSpec class for defining and validating
 * HTTP endpoint specifications within routes. It handles transformation from
 * plain object configurations to validated HttpTarget instances with proper
 * middleware composition and error handling.
 */

import HttpTarget from './http-target.js';

import {
    isFunction,
    assert,
    assertArray,
    assertNonEmptyString
} from '../assertions/mod.js';

import { HTTP_METHODS } from '../lib/http-utils.js';

/**
 * @typedef {Object} TargetSpecification
 * @property {string} name - Non-empty string name for the target
 * @property {string[]|string} methods - Array of HTTP methods or "*" for all methods
 * @property {Array<Function|HandlerDefinition>} handlers - Array of handler functions or definition tuples
 * @property {Array<Function|HandlerDefinition>} [errorHandlers] - Optional array of error handler functions or definition tuples
 */

/**
 * @typedef {[string, Object]} HandlerDefinition
 * Handler definition tuple containing handler name and options object
 */

/**
 * @typedef {Object} VirtualHost
 * @property {string} name - The virtual host name
 */

/**
 * @typedef {Object} RouteContext
 * @property {string} name - The route name
 * @property {Function[]} inboundMiddleware - Middleware executed before target handlers
 * @property {Function[]} outboundMiddleware - Middleware executed after target handlers
 * @property {Function[]} errorHandlers - Route-level error handlers
 */

/**
 * Represents the specification for a single HTTP target (handler) within a route.
 * Used to define the name, allowed HTTP methods, handler middleware, and error handlers
 * for a target endpoint. Provides validation and transformation utilities for
 * constructing HttpTarget instances from plain object specifications.
 */
export default class HttpTargetSpec {

    /**
     * Constructs a new HttpTargetSpec instance from a target specification
     * 
     * @param {TargetSpecification} spec - The target specification object
     * @throws {TypeError} When spec is not an object or missing required properties
     * 
     * @example
     * const targetSpec = new HttpTargetSpec({
     *   name: 'getUser',
     *   methods: ['GET'],
     *   handlers: [authenticateMiddleware, ['getUserHandler', { includeProfile: true }]],
     *   errorHandlers: [['handleUserError', {}]]
     * });
     */
    constructor(spec) {
        /**
         * The name of the target
         * @type {string}
         */
        this.name = spec.name;

        /**
         * The allowed HTTP methods for this target
         * @type {string[]|string}
         */
        this.methods = spec.methods;

        /**
         * The handler middleware for this target
         * @type {Array<Function|HandlerDefinition>}
         */
        this.handlers = spec.handlers;

        /**
         * The error handler middleware for this target
         * @type {Array<Function|HandlerDefinition>}
         */
        this.errorHandlers = spec.errorHandlers;
    }

    /**
     * Resolves handler and error handler definitions by replacing [name, options] tuples
     * with actual middleware functions from the provided factory maps
     *
     * @param {Map<string,Function>} handlers - Map of handler factory functions by name
     * @param {Map<string,Function>} errorHandlers - Map of error handler factory functions by name
     * @param {string} reportingName - Name used for error reporting context
     * @returns {void}
     * @throws {Error} When a referenced handler name is not found in the factory maps
     * 
     * @example
     * const handlerFactories = new Map([
     *   ['getUserHandler', (options) => (req, res, next) => { /* handler logic */ }]
     * ]);
     * targetSpec.assignHandlers(handlerFactories, new Map(), 'users:getUser');
     */
    assignHandlers(handlers, errorHandlers, reportingName) {
        // Transform handler definitions: convert [name, options] tuples to actual functions
        // while preserving already-resolved function references
        for (let i = 0; i < this.handlers.length; i += 1) {
            const def = this.handlers[i];

            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(handlers.has(name), `Unknown handler: ${ name } (in ${ reportingName })`);
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
                assert(errorHandlers.has(name), `Unknown error handler: ${ name } (in ${ reportingName })`);
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
     * Validates a target specification object and creates a new HttpTargetSpec instance
     * 
     * @param {Object} spec - The target specification object to validate
     * @param {string} parentName - The name of the parent context for error reporting
     * @param {number} index - The index of this target in the parent array for error reporting
     * @returns {HttpTargetSpec} The validated HttpTargetSpec instance
     * @throws {Error} When spec.name is not a non-empty string
     * @throws {Error} When spec.methods is not an array of valid HTTP methods or "*"
     * @throws {Error} When spec.handlers is not an array or contains invalid handler definitions
     * @throws {Error} When spec.errorHandlers exists but contains invalid error handler definitions
     * 
     * @example
     * // Valid specification
     * const spec = HttpTargetSpec.validateAndCreate({
     *   name: 'createUser',
     *   methods: ['POST'],
     *   handlers: [validateInput, ['createUserHandler', { sendEmail: true }]],
     *   errorHandlers: [['logError', {}]]
     * }, 'users', 0);
     * 
     * @example
     * // Using wildcard methods
     * const spec = HttpTargetSpec.validateAndCreate({
     *   name: 'catchAll',
     *   methods: '*',
     *   handlers: [defaultHandler]
     * }, 'fallback', 0);
     */
    static validateAndCreate(spec, parentName, index) {
        // Build contextual error reporting names for better debugging
        let reportingName = `${ parentName }[${ index }]`;

        // Validate target name first since we'll use it in subsequent error messages
        assertNonEmptyString(spec.name, `target.name must be a string (in ${ reportingName })`);

        const { name } = spec;

        // Update reporting name to include target name for clearer error context
        reportingName = `${ parentName }[${ index }]:${ name }`;

        // Process HTTP methods: "*" is syntactic sugar for all methods
        let methods;
        if (spec.methods === '*') {
            // Expand wildcard to full HTTP_METHODS array for consistency
            methods = HTTP_METHODS;
        } else {
            methods = spec.methods;
            assertArray(methods, `target.methods must be an Array or "*" (in ${ reportingName })`);
            
            // Validate each method against known HTTP methods
            for (const method of methods) {
                assert(HTTP_METHODS.includes(method), `Invalid HTTP method: ${ method } (in ${ reportingName })`);
            }
        }

        // Validate handlers array and its contents
        assertArray(spec.handlers, `target.handlers must be an Array (in ${ reportingName })`);

        for (const def of spec.handlers) {
            if (!isFunction(def)) {
                // Handler definition is a [name, options] tuple
                assertArray(def, `target.handlers[] must be an Array (in ${ reportingName })`);

                const [ handlerName ] = def;

                assertNonEmptyString(handlerName, `target.handlers[].name must be a string (in ${ reportingName })`);
            }
            // Functions are valid as-is, no further validation needed
        }

        // Error handlers are optional but follow same validation pattern
        if (spec.errorHandlers) {
            assertArray(spec.errorHandlers, `target.errorHandlers must be an Array (in ${ reportingName })`);

            for (const def of spec.errorHandlers) {
                if (!isFunction(def)) {
                    // Error handler definition is a [name, options] tuple
                    assertArray(def, `target.errorHandlers[] must be an Array (in ${ reportingName })`);

                    const [ handlerName ] = def;

                    assertNonEmptyString(handlerName, `target.errorHandlers[].name must be a string (in ${ reportingName })`);
                }
                // Functions are valid as-is, no further validation needed
            }
        }

        return new HttpTargetSpec({
            name,
            methods,
            handlers: spec.handlers,
            errorHandlers: spec.errorHandlers || [],
        });
    }
}

/**
 * Creates middleware function by calling a factory with provided options
 * 
 * @param {Map<string,Function>} middleware - Map of middleware factory functions
 * @param {HandlerDefinition} def - Handler definition tuple [name, options]
 * @returns {Function} The composed middleware function ready for use
 * @throws {Error} When the middleware factory is not found in the map
 */
function composeMiddleware(middleware, def) {
    const [ name, options ] = def;
    const factory = middleware.get(name);
    // Call factory with options to create the actual middleware function
    return factory(options);
}
