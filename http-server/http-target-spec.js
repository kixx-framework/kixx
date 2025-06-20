import HttpTarget from './http-target.js';

import {
    isFunction,
    assert,
    assertArray,
    assertNonEmptyString
} from '../assertions/mod.js';

import { HTTP_METHODS } from '../lib/http-utils.js';


export default class HttpTargetSpec {

    /**
     * Create a new HttpTargetSpec instance from a plain object specification.
     * The specification must include:
     * - name: A name for the target
     * - methods: Array of HTTP methods or "*" for all methods
     * - handlers: Array of handler functions or [name, options] tuples
     * - errorHandlers: Optional array of error handler functions or [name, options] tuples
     *
     * @param {Object} spec
     * @param {string} spec.name - Name for the target
     * @param {Array|string} spec.methods - Array of HTTP methods or "*"
     * @param {Array} spec.handlers - Array of handlers
     * @param {Array} [spec.errorHandlers] - Optional array of error handlers
     */
    constructor(spec) {
        this.name = spec.name;
        this.methods = spec.methods;
        this.handlers = spec.handlers;
        this.errorHandlers = spec.errorHandlers;
    }

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
