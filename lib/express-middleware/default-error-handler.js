'use strict';

const reportFullStackTrace = require(`../report-full-stack-trace`);

module.exports = function defaultErrorHandler(options = {}) {
	const {environment} = options;

	return function defaultErrorHandlerMiddleware(err, req, res, next) {
		if (!err) return next();

		const errors = Array.isArray(err) ? err : [err];
		err = errors[0];

		const statusCode = err.statusCode || 500;

		if (environment !== `production` || statusCode >= 500) {
			reportFullStackTrace(errors);
		}

		res.set(err.headers || {}).sendStatus(statusCode);
	};
};
