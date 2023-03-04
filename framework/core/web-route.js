// @ts-check

import PathToRegExp from 'path-to-regexp';
import KixxAssert from 'kixx-assert';

const { isObject, isNotEmpty } = KixxAssert.helpers;

const ALL = 'ALL';

export class RouteSpecification {

    /**
     * @type {String}
     */
    pattern;

    /**
     * An *optional* plain object which maps page handler functions to
     * HTTP methods. The enumerable keys of the object should map to
     * method names like GET, PUT, POST, OPTIONS, etc.
     * @type {Object=}
     */
    pageHandlers;

    /**
     * An *optional* plain object which maps midhandler functions to HTTP
     * methods. The enumerable keys of the object should map to HTTP method
     * names like GET, PUT, POST, or the special key "ALL". The values of
     * the keys should be Arrays of midhandler functions.
     * @type {Object=}
     */
    midhandlers;

    /**
     * An *optional* plain object which maps error handler functions to HTTP
     * methods. The enumerable keys of the object should map to HTTP method
     * names like GET, PUT, POST, or the special key "ALL". The values of
     * the keys should be error handler functions.
     * @type {Object=}
     */
    errorHandlers;
}

export default class WebRoute {

    pattern = null;
    matcher = null;
    pageHandlers = {};

    #midhandlers = new Map();
    #errorHandlers = new Map();

    constructor(spec) {
        this.pattern = spec.pattern || null;
        this.matcher = spec.matcher || null;
        this.pageHandlers = spec.pageHandlers || {};

        if (spec.midhandlers) {
            this.#midhandlers = spec.midhandlers;
        }
        if (spec.errorHandlers) {
            this.#errorHandlers = spec.errorHandlers;
        }
    }

    getAllowedMethods() {
        return Object.keys(this.pageHandlers);
    }

    getMidhandlersForMethod(method) {
        const handlers = this.#midhandlers.get(ALL) || [];
        return handlers.concat(this.#midhandlers.get(method) || []);
    }

    getErrorHandlerForMethod(method) {
        if (this.#errorHandlers.has(method)) {
            return this.#errorHandlers.get(method);
        }
        if (this.#errorHandlers.has(ALL)) {
            return this.#errorHandlers.get(ALL);
        }

        return null;
    }

    static fromSpecification(spec) {
        const props = {
            matcher: PathToRegExp.match(spec.pattern, { decode: decodeURIComponent }),
            pattern: spec.pattern,
        };

        if (isObject(spec.pageHandlers) && isNotEmpty(spec.pageHandlers)) {
            props.pageHandlers = spec.pageHandlers;
        }

        if (isObject(spec.midhandlers) && isNotEmpty(spec.midhandlers)) {
            props.midhandlers = new Map(Object.entries(spec.midhandlers));
        }

        if (isObject(spec.errorHandlers) && isNotEmpty(spec.errorHandlers)) {
            props.errorHandlers = new Map(Object.entries(spec.errorHandlers));
        }

        return new WebRoute(props);
    }
}
