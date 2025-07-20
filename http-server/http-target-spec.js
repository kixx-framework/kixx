import HttpTarget from './http-target.js';

import {
    isFunction,
    assert,
    assertArray,
    assertNonEmptyString
} from '../assertions/mod.js';

import { HTTP_METHODS } from '../lib/http-utils.js';


/**
 * @class HttpTargetSpec
 * @classdesc
 * Represents the specification for a single HTTP target (handler) within a route.
 * Used to define the name, allowed HTTP methods, handler middleware, and error handlers
 * for a target endpoint. Provides validation and transformation utilities for
 * constructing HttpTarget instances from plain object specifications.
 */
export default class HttpTargetSpec {

    /**
     * Constructs a new HttpTargetSpec instance from a plain object specification.
     *
     * The specification object must include:
     * - name: A non-empty string name for the target.
     * - methods: An array of HTTP methods (e.g., ['GET', 'POST']) or "*" for all methods.
     * - handlers: An array of handler functions or [name, options] tuples.
     * - errorHandlers: (Optional) An array of error handler functions or [name, options] tuples.
     *
     * @param {Object} spec - The target specification.
     * @param {string} spec.name - Name for the target.
     * @param {Array<string>|string} spec.methods - Array of HTTP methods or "*".
     * @param {Array<Function|Array>} spec.handlers - Array of handler functions or [name, options] tuples.
     * @param {Array<Function|Array>} [spec.errorHandlers] - Optional array of error handler functions or [name, options] tuples.
     */
    constructor(spec) {
        /**
         * The name of the target.
         * @type {string}
         */
        this.name = spec.name;

        /**
         * The allowed HTTP methods for this target.
         * @type {Array<string>|string}
         */
        this.methods = spec.methods;

        /**
         * The handler middleware for this target.
         * @type {Array<Function|Array>}
         */
        this.handlers = spec.handlers;

        /**
         * The error handler middleware for this target.
         * @type {Array<Function|Array>}
         */
        this.errorHandlers = spec.errorHandlers;
    }

    /**
     * Assigns actual handler and error handler functions to this spec,
     * replacing any [name, options] tuples with the composed middleware.
     *
     * @param {Map<string,Function>} handlers - Map of handler factories by name.
     * @param {Map<string,Function>} errorHandlers - Map of error handler factories by name.
     * @param {string} reportingName - Name used for error reporting context.
     * @returns {void}
     */
    assignHandlers(handlers, errorHandlers, reportingName) {
        for (let i = 0; i < this.handlers.length; i += 1) {
            const def = this.handlers[i];

            if (Array.isArray(def)) {
                const [ name ] = def;
                assert(handlers.has(name), `Unknown handler: ${ name } (in ${ reportingName })`);
                this.handlers[i] = composeMiddleware(handlers, def);
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
    }

    /**
     * Converts this HttpTargetSpec into an HttpTarget instance, combining
     * route and vhost context.
     *
     * @param {Object} vhost - The virtual host object (must have a 'name' property).
     * @param {Object} route - The route object (must have 'name', 'inboundMiddleware', 'outboundMiddleware', and 'errorHandlers').
     * @returns {HttpTarget} The constructed HttpTarget instance.
     */
    toHttpTarget(vhost, route) {
        const name = `${ vhost.name }:${ route.name }:${ this.name }`;
        const allowedMethods = this.methods;
        const middleware = route.inboundMiddleware.concat(this.handlers).concat(route.outboundMiddleware);
        const errorHandlers = this.errorHandlers.concat(route.errorHandlers);

        return new HttpTarget({
            name,
            allowedMethods,
            middleware,
            errorHandlers,
        });
    }

    /**
     * Validates a plain object specification and creates a new HttpTargetSpec instance.
     * Throws assertion errors if the specification is invalid.
     *
     * @param {Object} spec - The target specification object.
     * @param {string} parentName - The name of the parent context (for error reporting).
     * @param {number} index - The index of this target in the parent array (for error reporting).
     * @returns {HttpTargetSpec} The validated HttpTargetSpec instance.
     * @throws {AssertionError} If the specification is invalid.
     */
    static validateAndCreate(spec, parentName, index) {
        let reportingName = `${ parentName }[${ index }]`;

        assertNonEmptyString(spec.name, `target.name must be a string (in ${ reportingName })`);

        const { name } = spec;

        reportingName = `${ parentName }[${ index }]:${ name }`;

        let methods;
        if (spec.methods === '*') {
            methods = HTTP_METHODS;
        } else {
            methods = spec.methods;
            assertArray(methods, `target.methods must be an Array or "*" (in ${ reportingName })`);
            for (const method of methods) {
                assert(HTTP_METHODS.includes(method), `Invalid HTTP method: ${ method } (in ${ reportingName })`);
            }
        }

        assertArray(spec.handlers, `target.handlers must be an Array (in ${ reportingName })`);

        for (const def of spec.handlers) {
            if (!isFunction(def)) {
                assertArray(def, `target.handlers[] must be an Array (in ${ reportingName })`);

                const [ handlerName ] = def;

                assertNonEmptyString(handlerName, `target.handlers[].name must be a string (in ${ reportingName })`);
            }
        }

        if (spec.errorHandlers) {
            assertArray(spec.errorHandlers, `target.errorHandlers must be an Array (in ${ reportingName })`);

            for (const def of spec.errorHandlers) {
                if (!isFunction(def)) {
                    assertArray(def, `target.errorHandlers[] must be an Array (in ${ reportingName })`);

                    const [ handlerName ] = def;

                    assertNonEmptyString(handlerName, `target.errorHandlers[].name must be a string (in ${ reportingName })`);
                }
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


function composeMiddleware(middleware, def) {
    const [ name, options ] = def;
    const factory = middleware.get(name);
    return factory(options);
}
