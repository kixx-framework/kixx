// @ts-check

import {
    OperationalError,
    NotFoundError,
    MethodNotAllowedError,
    getFullStack
} from 'kixx-server-errors';

import KixxAssert from 'kixx-assert';
// Some imports are only used for type checking.
/* eslint-disable no-unused-vars */
import Logger from 'kixx-logger';
import EventBus from '../lib/event-bus.js';
import { ErrorEvent } from '../lib/events.js';
import WebRoute, { RouteSpecification } from './web-route.js';
import WrappedHttpRequest from '../servers/wrapped-http-request.js';
import WrappedHttpResponse from '../servers/wrapped-http-response.js';
import WebRequestContext from './web-request-context.js';
import {
    KixxError,
    getHttpStatusCode,
    isInternalServerError,
    errorToStackedError
} from '../lib/error-handling.js';
/* eslint-enable no-unused-vars */
import { createLogger } from '../lib/logger.js';

const { isFunction, isObject, isNotEmpty } = KixxAssert.helpers;

/**
 * @typedef ApplicationContextParams
 * @prop {String} name
 * @prop {Object} configs
 * @prop {Object} components
 * @prop {Array<RouteSpecification>} routes
 */

export default class ApplicationContext {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {Object}
     */
    configs = {};

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
     * @param {ApplicationContextParams} options
     */
    constructor(options) {

        const {
            name,
            configs,
            components,
            routes,
        } = options;

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            configs: {
                enumerable: true,
                value: configs,
            },
            eventBus: {
                enumerable: true,
                value: new EventBus(),
            },
        });

        this.#routes = routes.map(WebRoute.fromSpecification);
        this.#dependencies = new Map(Object.entries(components));
    }

    initialize(appConfig) {
        if (this.#initializingPromise) {
            return this.#initializingPromise;
        }

        const { environment } = appConfig;

        // Make the environment property permanent.
        Object.defineProperties(this, {
            environment: {
                enumerable: true,
                value: environment,
            },
            logger: {
                enumerable: true,
                value: createLogger({ environment, name: this.name }),
            },
        });

        this.eventBus.on(ErrorEvent.NAME, this.onErrorEvent.bind(this));

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

    onErrorEvent(event) {
        if (event.cause && isInternalServerError(event.cause)) {
            if (event.fatal) {
                this.logger.fatal('fatal event', event);
            } else {
                this.logger.error('error event', event);
            }
            this.logger.info(getFullStack(event.cause));
        }
    }

    routeWebRequest(request, response) {
        const { method } = request;
        const { pathname } = request.url;
        const route = this.#findMatchingHandlers(pathname, method);

        const {
            pattern,
            allowedMethods,
            pathnameParams,
            pageHandler,
            midhandlers,
        } = route;

        // @ts-ignore error TS2339: Property 'handleError' does not exist on type 'Function'.
        const errorHandler = route.errorHandler || this.constructor.handleError;

        let error = null;
        if (route.error) {
            error = errorToStackedError(
                `Routing error in application "${ this.name }"`,
                route.error
            );
        }

        const context = new WebRequestContext({
            name: pattern,
            configs: this.configs,
            components: Object.fromEntries(this.#dependencies),
            eventBus: this.eventBus,
            logger: this.logger,
            request,
            response,
            error,
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

                if (isNotEmpty(pageHandlers)) {
                    const allowedMethods = route.getAllowedMethods();
                    const pathnameParams = match.params;
                    let error = null; // eslint-disable-line no-shadow

                    if (!allowedMethods.includes(method)) {
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
        const unprocessableErrors = error.unprocessableErrors;
        const title = error.title || error.name || 'Unexpected Server Error';

        let html = `<p>${ title }</p>`;

        if (Array.isArray(unprocessableErrors) && unprocessableErrors.length > 0) {
            const messages = unprocessableErrors.map((uerr) => {
                return `<p>${ uerr.title || 'Unprocessable Error' }: ${ uerr.message || 'Invalid Data' }</p>`;
            });

            html += messages.join('\n');
        }

        html += '\n';

        const headers = new Headers({
            'content-type': 'text/html; charset=utf-8',
            'content-length': Buffer.byteLength(html, 'utf8').toString(),
        });

        return context.respondWith(html, { status, headers });
    }
}

export class Route {

    /**
     * @type {KixxError|null}
     */
    error = null;

    /**
     * @type {String}
     */
    pattern;

    /**
     * @type {Array}
     */
    allowedMethods = [];

    /**
     * @type {Object}
     */
    pathnameParams = {};

    /**
     * @type {(context:WebRequestContext) => WrappedHttpResponse}
     */
    pageHandler;

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

