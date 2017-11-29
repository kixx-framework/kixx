'use strict';

const ProgrammerError = require(`../classes/programmer-error`);
const MethodNotAllowedError = require(`../classes/method-not-allowed-error`);

const {isFunction, isObject} = require(`../../library`);

module.exports = function dispatchMethod(handlers) {
	if (!isObject(handlers)) {
		throw new ProgrammerError(
			`The handlers passed into dispatchMethod() must be a plain Object hash.`
		);
	}

	const methods = Object.keys(handlers);

	const headers = {
		Allow: methods.join(`,`)
	};

	return function dispatchMethodMiddleware(req, res, next) {
		const handler = handlers[req.method];

		if (!isFunction(handler)) {
			return next(new MethodNotAllowedError(
				`Only "${methods.join(`","`)}" method(s) allowed on ${req.originalUrl}`,
				{headers}
			));
		}

		return handler(req, res, next);
	};
};
