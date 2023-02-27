import { NotFoundError, MethodNotAllowedError } from 'kixx-server-errors';
import { deepFreeze } from 'kixx-lib-es6';
import WrappedRequest from './wrapped-request';
import WrappedResponse from './wrapped-response';

class WebRequestContext {

	request = null;
	response = null;
	pathnameParams = null;

	#appConfig = null;
	#midhandlerFunctions = [];
	#state = {};
	#pageHandler = null;
	#errorHandlers = null;
	#error = null;

	constructor(spec) {

		Object.defineProperties(this, {
			request: {
				enumerable: true,
				value: spec.request,
			},
			response: {
				enumerable: true,
				value: spec.response,
			},
			pathnameParams: {
				enumerable: true,
				value: deepFreeze(spec.pathnameParams),
			},
		});

		this.#appConfig = spec.appConfig;
		this.#midhandlerFunctions = spec.midhandlerFunctions || [];
		this.#state = spec.state || {};
		this.#pageHandler = spec.pageHandler;
		this.#errorHandlers = spec.errorHandlers || [];
		this.#error = null;
	}

	get errorHandler() {
		const index = this.#errorHandlers.length - 1;
		return this.#errorHandlers[index];
	}

	getAppName() {
		return this.#appConfig.name;
	}

	setState(newState) {
		Object.assign(this.#state, newState);
	}

	getState() {
		return structuredClone(this.#state);
	}

	static fromNodeRequest(appConfig, pageHandler, midhandlerFunctions, errorHandlers, params) {
		const SubClass = this;

		const {
			url,
			originatingPort,
			originatingProtocol,
			nodeHttpRequest,
			nodeHttpResponse,
			pathnameParams,
		} = params;

		const request = new WrappedRequest({
			url,
			originatingPort,
			originatingProtocol,
			nodeHttpRequest,
		});

		const response = new WrappedResponse({
			nodeHttpResponse,
			request,
		});

		if (typeof errorHandlers === 'function') {
			errorHandlers = [ errorHandlers ];
		} else if (!Array.isArray(errorHandlers)) {
			errorHandlers = [];
		}

		return new SubClass({
			request,
			response,
			pathnameParams,
			appConfig,
			midhandlerFunctions,
			pageHandler,
			errorHandlers,
		});
	}
}

function handleWebRequest(appConfig, request) {
	const {
		url,
		originatingPort,
		originatingProtocol,
		nodeHttpRequest,
		nodeHttpResponse,
	} = request;

	const { pathname } = url;
	const { method } = nodeHttpRequest;

	const {
		error,
		route,
		match,
		pageHandler,
		midhandlers,
		errorHandlers,
	} = findMatchingHandlers(routes, pathname, method);

	errorHandlers.unshift(errorHandler);

	const params = {
		url,
		originatingPort,
		originatingProtocol,
		nodeHttpRequest,
		nodeHttpResponse,
		pathnameParams: match && match.pathnameParams,
	};

	const context = WebRequestMiddlewareContext.fromNodeRequest(
		appConfig,
		pageHandler,
		midhandlers,
		errorHandlers,
		params
	);

	context.setRoute(route);
	context.setError(error);

	context.next();
}

class WebRequestMiddlewareContext extends WebRequestContext {

	#appConfig = null;
	#midhandlerFunctions = [];
	#state = {};
	#pageHandler = null;
	#errorHandlers = null;
	#error = null;

	next() {
		const midhandlerFunction = this.#midhandlerFunctions.shift();
		const errorHandler = this.errorHandler;

		if (this.#error) {
			return errorHandler(this, this.#error);
		}

		if (midhandlerFunction) {
			return safelyExecuteHandler(this, midhandlerFunction, errorHandler);
		}

		const context = this.#cloneWebRequestContext();

		return safelyExecuteHandler(context, this.#pageHandler, errorHandler);
	}

	#cloneWebRequestContext() {
		return new WebRequestContext(this);
	}
}

function findMatchingHandlers(routes, pathname, method) {
	let pageHandler = null;
	let midhandlers = [];
	let errorHandlers = [];

	for (let i = 0; i < routes.length; i = i + 1) {

		const route = routes[i];
		const match = route.matcher(pathname);

		if (match) {
			pageHandler = route.pageHandler;
			midhandlers = midhandlers.concat(route.getMidhandlersForMethod(method));
			errorHandlers = errorHandlers.concat(route.getErrorHandlers());

			if (pageHandler) {
				const { allowedMethods } = route;
				let error = null;

				if (!allowedMethods.includes(method)) {
					error = new MethodNotAllowedError(
						`"${ method }" method is not allowed on ${ pathname }`,
						{ info: { method, pathname, allowedMethods } },
						findMatchingHandlers
					);
				}

				return {
					error,
					route,
					match,
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
			{ info: { method, pathname } },
			findMatchingHandlers
		),
	};
}

function safelyExecuteHandler(context, handler, handleError) {
	let promise;

	try {
		promise = handler(context);
	} catch (cause) {
		handleError(context, cause);
		return Promise.resolve(false);
	}

	if (promise && promise.catch) {
		return promise.catch((cause) => {
			handleError(context, cause);
			return false;
		});
	}

	return promise;
}
