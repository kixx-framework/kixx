// @ts-check

import PathToRegExp from 'path-to-regexp';
import KixxAssert from 'kixx-assert';

const { isObject, isNotEmpty } = KixxAssert.helpers;

const ALL = 'all';

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
        const handlers = this.#errorHandlers.get(ALL) || [];
        return handlers.concat(this.#errorHandlers.get(method) || []);
    }

    static fromSpecification(spec) {
        const RouteClass = this;

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

        return new RouteClass(props);
    }
}
