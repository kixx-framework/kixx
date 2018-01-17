'use strict';

const StackedError = require(`../classes/stacked-error`);
const reportFullStackTrace = require(`../report-full-stack-trace`);

const JSON_API_CONTENT_TYPE = `application/vnd.api+json`;

const DEFAULT_CODE = `SERVER_ERROR`;
const DEFAULT_TITLE = `Server Error`;
const DEFAULT_DETAIL = `There was an unexpected error on the server.`;

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

function formatError(err) {
	err = StackedError.getOperationalError(err);
	const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
	const code = err.code ? err.code : DEFAULT_CODE;
	const title = err.title || DEFAULT_TITLE;
	const detail = err.detail || DEFAULT_DETAIL;

	const obj = {
		status: statusCode.toString(),
		code: statusCode === 500 ? DEFAULT_CODE : code,
		title: statusCode === 500 ? DEFAULT_TITLE : title,
		detail: statusCode === 500 ? DEFAULT_DETAIL : detail
	};

	if (err.parameter) {
		obj.source = {parameter: err.parameter};
	}
	if (err.pointer) {
		obj.source = {pointer: err.pointer};
	}

	obj.meta = {};

	return obj;
}

module.exports = function handleJsonApiError(options = {}) {
	const contentType = options.contentType || JSON_API_CONTENT_TYPE;
	const shouldReport = checkLogLevel(options.logLevel);

	return function handleJsonApiErrorMiddleware(err, req, res, next) {
		if (!err) return next();

		const errors = getErrorsList(err);
		err = StackedError.getOperationalError(errors[0]);

		const statusCode = err.statusCode || 500;

		if (shouldReport || statusCode >= 500) {
			reportFullStackTrace(errors);
		}

		const headers = Object.assign(
			{'Content-Type': contentType},
			err.headers || {}
		);

		res
			.status(statusCode)
			.set(headers)
			.send({
				errors: errors.map(formatError)
			});
	};
};
