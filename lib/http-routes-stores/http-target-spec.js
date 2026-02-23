import { ValidationError } from '../errors.js';
import {
    isFunction,
    isNonEmptyString,
    assertNonEmptyString
} from '../assertions.js';

import { HTTP_METHODS } from '../utils/http-utils.js';


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
     * @param {Array<string>} [spec.tags=[]] - Tags for categorizing and filtering targets
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
             * Tags for categorizing and filtering targets.
             * @name tags
             * @type {Array<string>}
             */
            tags: {
                value: spec.tags,
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
     * Validates a target specification object and creates a new HttpTargetSpec instance.
     *
     * Performs comprehensive validation of HTTP methods, handlers, error handlers, and tags.
     * Expands the '*' wildcard to all known HTTP methods. Validates that handler definitions
     * are either functions or properly formatted [name, options] tuples.
     *
     * @param {Object} spec - The target specification object to validate
     * @param {string} spec.name - Target identifier (required)
     * @param {string|Array<string>} spec.methods - HTTP methods array or '*' for all methods
     * @param {Array<string>} [spec.tags] - Optional tags for categorizing and filtering targets
     * @param {Array<Function|HandlerDefinition>} spec.handlers - Handler middleware functions or [name, options] tuples
     * @param {Array<Function|HandlerDefinition>} [spec.errorHandlers] - Optional error handler functions or [name, options] tuples
     * @param {string} routeName - The name of the route context for error reporting
     * @returns {HttpTargetSpec} The validated HttpTargetSpec instance
     * @throws {AssertionError} When spec.name is missing or empty
     */
    static validateAndCreate(spec, routeName) {

        // If a routeName is not passed in, then this is a programmer error, so throw an AssertionError.
        assertNonEmptyString(routeName);

        // If a target name is not provided, then this is a user error.
        if (!isNonEmptyString(spec.name)) {
            throw new ValidationError(`target.name is required and must be a non-empty string (in route: ${ routeName })`);
        }

        // Join name parts using a "/", but remove duplicates (replace "//" with "/").
        const name = `${ routeName }/${ spec.name }`.replace(/[/]+/g, '/');

        // Process HTTP methods: "*" is syntactic sugar for all methods
        let methods;
        if (spec.methods === '*') {
            // Expand wildcard to full HTTP_METHODS array for consistency
            methods = HTTP_METHODS;
        } else {
            methods = spec.methods;

            if (!Array.isArray(methods)) {
                throw new ValidationError(`target "${ name }" .methods must be an Array or "*"`);
            }

            // Validate each method against known HTTP methods
            for (const method of methods) {
                if (!HTTP_METHODS.includes(method)) {
                    throw new ValidationError(`target "${ name }" has an invalid HTTP method: ${ method }`);
                }
            }
        }

        // Tags are optional but must be an array of strings if provided
        const tags = spec.tags || [];
        if (spec.tags) {
            if (!Array.isArray(spec.tags)) {
                throw new ValidationError(`target "${ name }" .tags must be an Array`);
            }

            for (const tag of spec.tags) {
                if (!isNonEmptyString(tag)) {
                    throw new ValidationError(`target "${ name }" .tags[] must only contain non-empty strings`);
                }
            }
        }

        // Validate handlers array and its contents
        if (!Array.isArray(spec.handlers)) {
            throw new ValidationError(`target "${ name }" .handlers must be an Array`);
        }

        for (let i = 0; i < spec.handlers.length; i += 1) {
            const def = spec.handlers[ i ];
            if (!isFunction(def)) {
                // Handler definition is a [name, options] tuple
                if (!Array.isArray(def)) {
                    throw new ValidationError(`target "${ name }" .handlers[${ i }] must be an Array`);
                }

                const [ handlerName ] = def;

                if (!isNonEmptyString(handlerName)) {
                    throw new ValidationError(`target "${ name }" .handlers[${ i }][0] must be a string`);
                }
            }
            // Functions are valid as-is, no further validation needed
        }

        // Error handlers are optional but follow same validation pattern
        if (spec.errorHandlers) {
            if (!Array.isArray(spec.errorHandlers)) {
                throw new ValidationError(`target "${ name }" .errorHandlers must be an Array`);
            }

            for (let i = 0; i < spec.errorHandlers.length; i += 1) {
                const def = spec.errorHandlers[ i ];
                if (!isFunction(def)) {
                    // Error handler definition is a [name, options] tuple
                    if (!Array.isArray(def)) {
                        throw new ValidationError(`target "${ name }" .errorHandlers[${ i }] must be an Array`);
                    }

                    const [ handlerName ] = def;

                    if (!isNonEmptyString(handlerName)) {
                        throw new ValidationError(`target "${ name }" .errorHandlers[${ i }][0] must be a string`);
                    }
                }
                // Functions are valid as-is, no further validation needed
            }
        }

        return new HttpTargetSpec({
            name,
            methods,
            tags,
            handlers: spec.handlers,
            errorHandlers: spec.errorHandlers || [],
        });
    }
}
