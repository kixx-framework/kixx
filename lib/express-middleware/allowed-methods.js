'use strict';

const MethodNotAllowedError = require(`../classes/method-not-allowed-error`);

module.exports = function allowedMethods(options = {}) {
	const methods = Array.isArray(options.methods) ? Object.freeze(options.methods.slice()) : [];

	const headers = {
		Allow: methods.join(`,`)
	};

	return function allowedMethodsMiddleware(req, res, next) {
		if (methods.indexOf(req.method) >= 0) {
			return next();
		}

		return next(new MethodNotAllowedError(
			`Only '${methods.join(`','`)}' method(s) allowed on ${req.originalUrl}`,
			{headers}
		));
	};
};

