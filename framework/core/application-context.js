// @ts-check

import {
    OperationalError,
    NotFoundError,
    MethodNotAllowedError
} from 'kixx-server-errors';

import KixxAssert from 'kixx-assert';
// Some imports are only used for type checking.
/* eslint-disable no-unused-vars */
import Logger from 'kixx-logger';
import EventBus from '../lib/event-bus.js';
import WebRoute, { RouteSpecification } from './web-route.js';
import { WebRequestMidContext } from './web-request-context.js';
import { KixxError, getHttpStatusCode, errorToStackedError } from '../lib/error-handling.js';
/* eslint-enable no-unused-vars */
import { createLogger } from '../lib/logger.js';

const { isFunction, isObject, isString } = KixxAssert.helpers;

/**
 * @typedef ApplicationContextParams
 * @prop {String} name
 * @prop {String} environment
 * @prop {Array} components
 * @prop {Array<RouteSpecification>} routes
 */

export default class ApplicationContext {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {String}
     */
    environment;

    /**
     * @type {EventBus}
     */
    eventBus;

    /**
     * @type {Logger}
     */
    logger;

    /**
     * @type {Promise<ApplicationContext> | null}
     */
    #initializingPromise = null;

    /**
     * @type {Map}
     */
    #dependencies = new Map();

    /**
     * @type {Array}
     */
    #routes = [];

    /**
     * @param {ApplicationContextParams} params
     */
    constructor({ name, environment, components, routes }) {

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            environment: {
                enumerable: true,
                value: environment,
            },
            eventBus: {
                enumerable: true,
                value: new EventBus(),
            },
            logger: {
                enumerable: true,
                value: createLogger({ environment, name }),
            },
        });

        this.#routes = routes.map(WebRoute.fromSpecification);
        this.#dependencies = new Map(Object.entries(components));
    }

    initialize() {
        if (this.#initializingPromise) {
            return this.#initializingPromise;
        }

        const dependencies = Array.from(this.#dependencies);

        const promises = dependencies.map(([ key, component ]) => {
            return this.#initializeComponent(component, key);
        });

        this.#initializingPromise = Promise.all(promises).then((components) => {
            components.forEach((comp, index) => {
                const [ key ] = dependencies[index];
                this.#dependencies.set(key, comp);
            });

            return this;
        });

        return this.#initializingPromise;
    }

    routeWebRequest(request, response) {
        const { method } = request;
        const { pathname } = request.url;
        const route = this.#findMatchingHandlers(pathname, method);

        const {
            error,
            pattern,
            allowedMethods,
            pathnameParams,
            pageHandler,
            midhandlers,
        } = route;

        // @ts-ignore error TS2339: Property 'handleError' does not exist on type 'Function'.
        const errorHandler = route.errorHandler || this.constructor.handleError;

        const context = new WebRequestMidContext({
            name: pattern,
            components: Object.fromEntries(this.#dependencies),
            request,
            response,
            error: errorToStackedError(`Routing error in application "${ this.name }"`, error),
            allowedMethods,
            pathnameParams,
            pageHandler,
            midhandlers,
            errorHandler,
        });

        // TODO: Ensure an HTTP response object was returned.
        return context.next();
    }

    #initializeComponent(component, name) {
        if (!isFunction(component) && !isFunction(component.initialize)) {
            return component;
        }

        let promise;
        try {
            if (isFunction(component.initialize)) {
                promise = component.initialize(this);
            } else {
                promise = component(this);
            }
        } catch (cause) {
            return Promise.reject(new OperationalError(
                `Error initializing component "${ name }"`,
                { cause, fatal: true, info: { name } }
            ));
        }

        if (promise && isFunction(promise.catch)) {
            return promise.catch((cause) => {
                throw new OperationalError(
                    `Error initializing component "${ name }"`,
                    { cause, fatal: true, info: { name } }
                );
            });
        }

        return promise;
    }

    #findMatchingHandlers(pathname, method) {
        let pageHandler = null;
        let midhandlers = [];
        let errorHandler = null;

        for (let i = 0; i < this.#routes.length; i = i + 1) {

            const route = this.#routes[i];
            const match = route.matcher(pathname);

            if (match) {
                const { pageHandlers } = route;

                midhandlers = midhandlers.concat(route.getMidhandlersForMethod(method));

                const newErrorHandler = route.getErrorHandlerForMethod(method);

                if (newErrorHandler) {
                    errorHandler = newErrorHandler;
                }

                if (pageHandlers.length > 0) {
                    const allowedMethods = route.getAllowedMethods();
                    const pathnameParams = match.params;
                    let error = null; // eslint-disable-line no-shadow

                    if (allowedMethods.includes(method)) {
                        error = new MethodNotAllowedError(
                            `"${ method }" method is not allowed on ${ pathname }`,
                            { info: { method, pathname, allowedMethods } }
                        );
                    } else {
                        pageHandler = pageHandlers[method];
                    }

                    return new Route({
                        error,
                        pattern: route.pattern,
                        allowedMethods,
                        pathnameParams,
                        pageHandler,
                        midhandlers,
                        errorHandler,
                    });
                }
            }
        }

        const error = new NotFoundError(
            `Pathname ${ pathname } not present in this application`,
            { info: { method, pathname } }
        );

        return new Route({
            error,
            midhandlers,
            errorHandler,
        });
    }

    static handleError(context, error) {
        const status = getHttpStatusCode(error) || 500;
        const [ headersSource, body ] = this.renderErrorResponse(context, error);

        /**
         * @type {Headers}
         */
        let headers;

        if (headersSource && isFunction(headersSource.set)) {
            headers = headersSource;
        } else {
            headers = new Headers(headersSource || {});
        }

        if (isString(body)) {
            headers.set('content-length', Buffer.byteLength(body, 'utf8').toString());
        } else if (Buffer.isBuffer(body)) {
            headers.set('content-length', body.length.toString());
        }

        return context.respondWith(body, { status, headers });
    }

    /**
     * @param  {KixxError} error
     * @return {[Headers,string]}
     */
    static renderErrorResponse(_, error) {
        const unprocessableErrors = error.unprocessableErrors;
        const title = error.title || error.name || 'Unexpected Server Error';

        let html = `<p>${ title }</p>`;

        if (Array.isArray(unprocessableErrors) && unprocessableErrors.length > 0) {
            const messages = unprocessableErrors.map((uerr) => {
                return `<p>${ uerr.title || 'Unprocessable Error' }: ${ uerr.message || 'Invalid Data' }</p>`;
            });

            html += messages.join('\n');
        }

        const headers = new Headers({
            'content-type': 'text/html; charset=utf-8',
        });

        return [ headers, html ];
    }
}

export class Route {

    /**
     * @type {KixxError|null}
     */
    error = null;

    /**
     * @type {String|null}
     */
    pattern = null;

    /**
     * @type {Array}
     */
    allowedMethods = [];

    /**
     * @type {Object}
     */
    pathnameParams = {};

    /**
     * @type {Function|null}
     */
    pageHandler = null;

    /**
     * @type {Array}
     */
    midhandlers = [];

    /**
     * @type {Function|null}
     */
    errorHandler = null;

    constructor(spec) {
        this.error = spec.error || null;
        this.pattern = spec.pattern || null;
        this.allowedMethods = Array.isArray(spec.allowedMethods) ? spec.allowedMethods : [];
        this.pathnameParams = isObject(spec.pathnameParams) ? spec.pathnameParams : {};
        this.pageHandler = isFunction(spec.pageHandler) ? spec.pageHandler : null;
        this.midhandlers = Array.isArray(spec.midhandlers) ? spec.midhandlers : [];
        this.errorHandler = isFunction(spec.errorHandler) ? spec.errorHandler : null;
    }
}

