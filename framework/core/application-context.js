// @ts-check

import {
    OperationalError,
    NotFoundError,
    MethodNotAllowedError
} from 'kixx-server-errors';

import KixxAssert from 'kixx-assert';

// These imports are for type checking.
// eslint-disable-next-line no-unused-vars
import KixxError from '../lib/kixx-error.js';

import WebRoute from './web-route.js';
import { WebRequestMidContext } from './web-request-context.js';
import { getHttpStatusCode } from '../lib/error-handling.js';

const { isFunction, isObject, isString } = KixxAssert.helpers;

export default class ApplicationContext {

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

    constructor({ routes }) {
        this.#routes = routes.map(WebRoute.fromSpecification);
    }

    registerComponent(name, component) {
        this.#dependencies.set(name, component);
        return this;
    }

    initialize() {
        if (this.#initializingPromise) {
            return this.#initializingPromise;
        }

        const dependencies = Array.from(this.#dependencies);

        const promises = dependencies.map(([ key, component ]) => {
            return initializeComponent(component, key);
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
            allowedMethods,
            pathnameParams,
            pageHandler,
            midhandlers,
        } = route;

        // @ts-ignore error TS2339: Property 'handleError' does not exist on type 'Function'.
        const errorHandler = route.errorHandler || this.constructor.handleError;

        const context = new WebRequestMidContext({
            components: Object.fromEntries(this.#dependencies),
            request,
            response,
            error,
            allowedMethods,
            pathnameParams,
            pageHandler,
            midhandlers,
            errorHandler,
        });

        return context.next();
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
        this.allowedMethods = Array.isArray(spec.allowedMethods) ? spec.allowedMethods : [];
        this.pathnameParams = isObject(spec.pathnameParams) ? spec.pathnameParams : {};
        this.pageHandler = isFunction(spec.pageHandler) ? spec.pageHandler : null;
        this.midhandlers = Array.isArray(spec.midhandlers) ? spec.midhandlers : [];
        this.errorHandler = isFunction(spec.errorHandler) ? spec.errorHandler : null;
    }
}

function initializeComponent(component, name) {
    if (!isFunction(component) && !isFunction(component.initialize)) {
        return component;
    }

    let promise;
    try {
        if (isFunction(component.initialize)) {
            promise = component.initialize();
        } else {
            promise = component();
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

