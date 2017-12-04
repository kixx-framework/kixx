'use strict';

const StackedError = require(`../classes/stacked-error`);
const reportFullStackTrace = require(`../report-full-stack-trace`);

const LOG_LEVELS = {
	fatal: 60,
	FATAL: 60,
	error: 50,
	ERROR: 50,
	warn: 40,
	WARN: 40,
	info: 30,
	INFO: 30,
	debug: 20,
	DEBUG: 20,
	trace: 10,
	TRACE: 10
};

function checkLogLevel(level) {
	let levelN = 10;
	if (level) {
		levelN = (Number.isInteger(level) ? level : LOG_LEVELS[level]) || 10;
	}

	return levelN <= LOG_LEVELS.DEBUG;
}

function getErrorsList(err) {
	if (Array.isArray(err.errors)) {
		return err.errors.filter(filterStackedError);
	}
	if (Array.isArray(err)) {
		return err.filter(filterStackedError);
	}
	return [err];
}

function filterStackedError(err) {
	return err.name !== `StackedError`;
}

module.exports = function defaultErrorHandler(options = {}) {
	const shouldReport = checkLogLevel(options.logLevel);

	return function defaultErrorHandlerMiddleware(err, req, res, next) {
		if (!err) return next();

		const errors = getErrorsList(err);
		err = StackedError.getOperationalError(errors[0]);

		const statusCode = err.statusCode || 500;

		if (shouldReport || statusCode >= 500) {
			reportFullStackTrace(errors);
		}

		res.set(err.headers || {}).sendStatus(statusCode);
	};
};
