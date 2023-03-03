// @ts-check

import { ProgrammerError } from 'kixx-server-errors';
// These imports are for type checking.
/* eslint-disable no-unused-vars */
import { Logger } from 'kixx-logger';
import { KixxError, errorToStackedError } from '../lib/error-handling.js';
import EventBus from '../lib/event-bus.js';
import WrappedHttpRequest from '../servers/wrapped-http-request.js';
import WrappedHttpResponse from '../servers/wrapped-http-response.js';
/* eslint-enable no-unused-vars */
import { ErrorEvent } from '../lib/events.js';

/**
 * @typedef {Object} WebRequestContextSpecification
 * @prop {String} name
 * @prop {Object} configs
 * @prop {Object} components
 * @prop {EventBus} eventBus
 * @prop {Logger} logger
 * @prop {WrappedHttpRequest} request
 * @prop {WrappedHttpResponse} response
 * @prop {Array<String>} allowedMethods
 * @prop {Object} pathnameParams
 * @prop {(context:WebRequestContext, error:KixxError) => WrappedHttpResponse} errorHandler
 * @prop {(context:WebRequestContext) => WrappedHttpResponse} pageHandler
 * @prop {Array<Function>} midhandlers
 * @prop {KixxError|null} error
 */

export default class WebRequestContext {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {Object}
     */
    configs = {};

    /**
     * @type {Object}
     */
    components = {};

    /**
     * @type {EventBus}
     */
    eventBus;

    /**
     * @type {Logger}
     */
    logger;

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
     * @type {(context:WebRequestContext, error:KixxError) => WrappedHttpResponse}
     */
    errorHandler;

    /**
     * @type {(context:WebRequestContext) => WrappedHttpResponse}
     */
    pageHandler;

    /**
     * @type {KixxError|Error|null}
     */
    #error;

    /**
     * @type {Array}
     */
    #midhandlers = [];

    /**
     * @type {Boolean}
     */
    #executedPageHandler = false;

    /**
     * @param {WebRequestContextSpecification} spec
     */
    constructor(spec) {
        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: spec.name,
            },
            configs: {
                enumerable: true,
                value: Object.freeze(spec.configs),
            },
            components: {
                enumerable: true,
                value: Object.freeze(spec.components),
            },
            eventBus: {
                enumerable: true,
                value: spec.eventBus,
            },
            logger: {
                enumerable: true,
                value: spec.logger,
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

    /**
     * @param  {String} body
     * @param  {Object=} options
     * @return {WrappedHttpResponse}
     */
    respondWithHtml(body, options = {}) {
        return this.response.setResponse(body, options)
            .setHeader('content-type', 'text/html; charset=utf-8')
            .setHeader('content-length', Buffer.byteLength(body));
    }

    /**
     * @param  {any} data
     * @param  {Object=} options
     * @return {WrappedHttpResponse}
     */
    respondWithJson(data, options = {}) {
        const body = JSON.stringify(data);

        return this.response.setResponse(body, options)
            .setHeader('content-type', 'application/json; charset=utf-8')
            .setHeader('content-length', Buffer.byteLength(body));
    }

    next() {
        if (this.#executedPageHandler) {
            return this.#catchAndHandleError(new ProgrammerError(
                `Cannot call next(); page handler for ${ this.name } has already been called`,
                { fatal: true, name: this.name }
            ));
        }

        if (this.#error) {
            const error = this.#error;
            this.#error = null;
            return this.#catchAndHandleError(error);
        }

        const midhandler = this.#midhandlers.shift();

        if (midhandler) {
            return this.#safelyExecuteHandler(midhandler);
        }

        this.#executedPageHandler = true;
        return this.#safelyExecuteHandler(this.pageHandler);
    }

    #safelyExecuteHandler(handler) {
        let promise;

        try {
            promise = handler(this);
        } catch (cause) {
            return this.#catchAndHandleError(cause);
        }

        if (promise && promise.catch) {
            return promise.catch((cause) => {
                return this.#catchAndHandleError(cause);
            });
        }

        return promise;
    }

    #catchAndHandleError(cause) {
        const message = `Web request handler error in route "${ this.name }"`;

        if (!cause) {
            // This ensures we have an error, and not null (returned from errorToStackedError below).
            cause = new ProgrammerError(message, { fatal: true, name: this.name });
        }

        const error = errorToStackedError(message, cause);
        // @ts-ignore error TS2322: Type 'KixxError | null' is not assignable to type 'KixxError'
        const res = this.errorHandler(this, error);
        // @ts-ignore error TS2322: Type 'KixxError | null' is not assignable to type 'KixxError'
        const event = new ErrorEvent(error);

        // Emit the error event after the response is returned.
        setTimeout(() => {
            this.eventBus.emitEvent(event);
        }, 1);

        return res;
    }
}
