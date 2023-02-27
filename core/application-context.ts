import {
    OperationalError,
    NotFoundError,
    MethodNotAllowedError
} from 'kixx-server-errors';

import KixxAssert from 'kixx-assert';
import WebRequestMidhandlerContext from './web-request-midhandler-context.ts';
import WrappedRequest from './wrapped-request.ts';
import { getHttpStatusCode } from '../lib/error-handling.ts';

const { isFunction, isString, isDefined } = KixxAssert.helpers;

export default class ApplicationContext {

    #initializingPromise = null;
    #dependencies = new Map();
    // TODO: Initialize routes.
    #routes = [];

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

            return true;
        });

        return this.#initializingPromise;
    }

    routeNodeWebRequest(webRequest) {
        const {
            url,
            originatingPort,
            originatingProtocol,
            nodeHttpRequest,
            nodeHttpResponse,
        } = webRequest;

        const { pathname } = url;
        const { method } = nodeHttpRequest;
        const route = this.#findMatchingHandlers(pathname, method);

        const {
            error,
            pathnameParams,
            pageHandler,
            midhandlers,
            errorHandlers,
        } = route;

        errorHandlers.unshift(this.constructor.handleError);

        const request = new WrappedRequest({
            url,
            originatingPort,
            originatingProtocol,
            nodeHttpRequest,
            nodeHttpResponse,
        });

        const context = new WebRequestMidhandlerContext({
            components: Object.fromEntries(this.#dependencies),
            error,
            request,
            pathnameParams,
            pageHandler,
            midhandlers,
            errorHandlers,
        });

        return context.next();
    }

    #findMatchingHandlers(pathname, method) {
        let pageHandler = null;
        let midhandlers = [];
        let errorHandlers = [];

        for (let i = 0; i < this.#routes.length; i = i + 1) {

            const route = this.routes[i];
            const match = route.matcher(pathname);

            if (match) {
                pageHandler = route.pageHandler;
                midhandlers = midhandlers.concat(route.getMidhandlersForMethod(method));
                errorHandlers = errorHandlers.concat(route.getErrorHandlers());
                const { pathnameParams } = match;

                if (pageHandler) {
                    const { allowedMethods } = route;
                    let error = null;

                    if (!allowedMethods.includes(method)) {
                        error = new MethodNotAllowedError(
                            `"${ method }" method is not allowed on ${ pathname }`,
                            { info: { method, pathname, allowedMethods } }
                        );
                    }

                    return {
                        error,
                        pathnameParams,
                        pageHandler,
                        midhandlers,
                        errorHandlers,
                    };
                }
            }
        }

        return {
            error: new NotFoundError(
                `Pathname ${ pathname } not present in this application`,
                { info: { method, pathname } }
            ),
            pathnameParams: {},
            pageHandler,
            midhandlers,
            errorHandlers,
        };
    }

    static handleError(context, error) {
        const status = getHttpStatusCode(error) || 500;
        const [ headersSource, body ] = this.renderErrorResponse(context, error);

        let headers;

        if (headersSource && isFunction(headersSource.set)) {
            headers = headersSource;
        } else {
            headers = new Headers(headersSource || {});
        }

        let contentLength;

        if (isString(body)) {
            contentLength = Buffer.byteLength(body, 'utf8');
        } else if (Buffer.isBuffer(body)) {
            contentLength = body.length;
        }

        if (isDefined(contentLength)) {
            headers.set('content-length', contentLength);
        }

        // TODO: How does respondWith() work?
        return context.respondWith(body, { status, headers });
    }

    static renderErrorResponse(context, error) {
        error = error || {};

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

function initializeComponent(component, name) {
    if (!isFunction(component.initialize)) {
        return component;
    }

    let promise;
    try {
        promise = component.initialize();
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

