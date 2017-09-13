'use strict';

const R = require(`ramda`);
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

		return new Router(R.assoc(
			`routes`,
			R.append(new Route(pattern, handler), this.routes),
			this
		));
	}

	addErrorHandler(handler) {
		if (!isFunction(handler)) {
			throw new Error(`Router#addErrorHandler() expects handler Function.`);
		}

		return new Router(R.assoc(
			`errorHandlers`,
			R.append(handler, this.errorHandlers),
			this
		));
	}

	addNotFoundHandler(handler) {
		if (!isFunction(handler)) {
			throw new Error(`Router#addNotFoundHandler() expects handler Function.`);
		}

		return new Router(R.assoc(
			`notFoundHandlers`,
			R.append(handler, this.notFoundHandlers),
			this
		));
	}

	static is(x) {
		return x instanceof Router;
	}
}

module.exports = Router;
