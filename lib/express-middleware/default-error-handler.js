'use strict';

const StackedError = require(`../classes/stacked-error`);
const reportFullStackTrace = require(`../report-full-stack-trace`);

function getErrorsList(err) {
	if (Array.isArray(err.errors)) {
		return [err].concat(err.errors);
	}
	if (Array.isArray(err)) {
		return err;
	}
	return [err];
}

module.exports = function defaultErrorHandler(options = {}) {
	const {skipSend} = options;

	return function defaultErrorHandlerMiddleware(err, req, res, next) {
		if (!err) return next();

		const errors = getErrorsList(err);
		err = StackedError.getOperationalError(errors[0]);

		const statusCode = err.statusCode || 500;

		if (statusCode >= 500) {
			reportFullStackTrace(errors);
		}

		if (!skipSend) {
			res.set(err.headers || {}).sendStatus(statusCode);
		} else {
			next(err);
		}

		return null;
	};
};
