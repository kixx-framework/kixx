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

		this.route = this.route.bind(this);
		this.addErrorHandler = this.addErrorHandler.bind(this);

		Object.defineProperties(this, {
			routes: {
				enumerable: true,
				value: Object.freeze(spec.routes || [])
			},
			errorHandlers: {
				enumerable: true,
				value: Object.freeze(spec.errorHandlers || [])
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

		return new Router(Object.assign({}, this, {routes}));
	}

	addErrorHandler(handler) {
		if (!isFunction(handler)) {
			throw new Error(`Router#addErrorHandler() expects handler Function.`);
		}

		const errorHandlers = this.errorHandlers.slice();
		errorHandlers.push(handler);

		return new Router(Object.assign({}, this, {errorHandlers}));
	}
}

module.exports = Router;
