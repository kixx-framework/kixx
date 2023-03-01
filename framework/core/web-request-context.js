// @ts-check

// These imports are for type checking.
// eslint-disable-next-line no-unused-vars
import WrappedHttpRequest from '../servers/wrapped-http-request.js';
// eslint-disable-next-line no-unused-vars
import WrappedHttpResponse from '../servers/wrapped-http-response.js';


export default class WebRequestContext {

    /**
     * @type {Object}
     */
    components = {};

    /**
     * @type {WrappedHttpRequest}
     */
    request;

    /**
     * @type {WrappedHttpResponse}
     */
    response;

    /**
     * @type {Array}
     */
    allowedMethods = [];

    /**
     * @type {Object}
     */
    pathnameParams = {};

    /**
     * @type {Function}
     */
    errorHandler;

    /**
     * @type {Function}
     */
    pageHandler;

    /**
     * @type {Error}
     */
    #error;

    /**
     * @type {Array}
     */
    #midhandlers = [];

    constructor(spec) {
        Object.defineProperties(this, {
            components: {
                enumerable: true,
                value: Object.freeze(spec.components),
            },
            request: {
                enumerable: true,
                value: spec.request,
            },
            response: {
                enumerable: true,
                value: spec.response,
            },
            allowedMethods: {
                enumerable: true,
                value: Object.freeze(spec.allowedMethods),
            },
            pathnameParams: {
                enumerable: true,
                value: spec.pathnameParams,
            },
            errorHandler: {
                enumerable: false,
                value: spec.errorHandler,
            },
            pageHandler: {
                enumerable: false,
                value: spec.pageHandler,
            },
        });

        this.#error = spec.error || null;
        this.#midhandlers = spec.midhandlers;
    }

    respondWith(body, options) {
        return this.response.setResponse(body, options);
    }

    respondWithHtml(body, options) {
        return this.response.setResponse(body, options)
            .setHeader('content-type', 'text/html; charset=utf-8')
            .setHeader('content-length', Buffer.byteLength(body));
    }

    respondWithJson(data, options) {
        const body = JSON.stringify(data);

        return this.response.setResponse(body, options)
            .setHeader('content-type', 'application/json; charset=utf-8')
            .setHeader('content-length', Buffer.byteLength(body));
    }
}

export class WebRequestMidContext extends WebRequestContext {

    #error = null;
    #midhandlers = [];

    next() {
        if (this.#error) {
            const error = this.#error;
            this.#error = null;
            return this.errorHandler(this, error);
        }

        const midhandler = this.#midhandlers.shift();

        if (midhandler) {
            return safelyExecuteHandler(this, midhandler, this.errorHandler);
        }

        const context = this.#cloneWebRequestContext();

        return safelyExecuteHandler(context, this.pageHandler, this.errorHandler);
    }

    #cloneWebRequestContext() {
        return new WebRequestContext({
            components: this.components,
            allowedMethods: this.allowedMethods,
            request: this.request,
            pathnameParams: this.pathnameParams,
            pageHandler: this.pageHandler,
            errorHandler: this.errorHandler,
            midhandlers: this.#midhandlers,
        });
    }
}

function safelyExecuteHandler(context, handler, handleError) {
    let promise;

    try {
        promise = handler(context);
    } catch (cause) {
        return handleError(context, cause);
    }

    if (promise && promise.catch) {
        return promise.catch((cause) => {
            return handleError(context, cause);
        });
    }

    return promise;
}
