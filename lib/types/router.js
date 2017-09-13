'use strict';

const pathToRegexp = require(`path-to-regexp`);
const {isString, isFunction} = require(`../`);

class Route {
	constructor(pattern, handler) {
		const keys = [];
		const regexp = pathToRegexp(pattern, keys);

		Object.defineProperties(this, {
			pattern: {
				enumerable: true,
				value: pattern
			},
			handler: {
				enumerable: true,
				value: handler
			},
			regexp: {
				enumerable: true,
				value: regexp
			},
			keys: {
				enumerable: true,
				value: Object.freeze(keys)
			}
		});
	}
}

class Router {
	constructor(spec) {
		spec = spec || {};

		Object.defineProperties(this, {
			routes: {
				enumerable: true,
				value: Object.freeze(spec.routes || [])
			},
			errorHandlers: {
				value: Object.freeze(spec.errorHandlers || [])
			},
			notFoundHandlers: {
				value: Object.freeze(spec.notFoundHandlers || [])
			}
		});
	}

	route(pattern, handler) {
		if (!isString(pattern)) {
			throw new Error(`Router#route() expects String pattern.`);
		}
		if (!isFunction(handler)) {
			throw new Error(`Router#route() expects handler Function.`);
		}

		const routes = this.routes.slice();
		routes.push(new Route(pattern, handler));

		return updateRouter(this, {routes});
	}

	addErrorHandler(handler) {
		if (!isFunction(handler)) {
			throw new Error(`Router#addErrorHandler() expects handler Function.`);
		}

		const errorHandlers = this.errorHandlers.slice();
		errorHandlers.push(handler);

		return updateRouter(this, {errorHandlers});
	}

	addNotFoundHandler(handler) {
		if (!isFunction(handler)) {
			throw new Error(`Router#addNotFoundHandler() expects handler Function.`);
		}

		const notFoundHandlers = this.notFoundHandlers.slice();
		notFoundHandlers.push(handler);

		return updateRouter(this, {notFoundHandlers});
	}
}

function updateRouter(oldProps, newProps) {
	return new Router({
		routes: newProps.routes || oldProps.routes,
		errorHandlers: newProps.errorHandlers || oldProps.errorHandlers,
		notFoundHandlers: newProps.notFoundHandlers || oldProps.notFoundHandlers
	});
}

module.exports = Router;
