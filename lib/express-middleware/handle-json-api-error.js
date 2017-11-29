'use strict';

const StackedError = require(`../classes/stacked-error`);
const reportFullStackTrace = require(`../report-full-stack-trace`);

const JSON_API_CONTENT_TYPE = `application/vnd.api+json`;

module.exports = function handleJsonApiError(options = {}) {
	const {environment} = options;
	const contentType = options.contentType || JSON_API_CONTENT_TYPE;

	return function handleJsonApiErrorMiddleware(err, req, res, next) {
		if (!err) return next();

		const errors = Array.isArray(err.errors) ? err.errors : [err];
		err = StackedError.getOperationalError(errors[0]);

		const statusCode = err.statusCode || 500;

		if (environment !== `production` || statusCode >= 500) {
			reportFullStackTrace(errors);
		}

		const headers = Object.assign(
			{'Content-Type': contentType},
			err.headers || {}
		);

		function formatError(err) {
			err = StackedError.getOperationalError(err);

			const obj = {
				status: Number.isInteger(err.statusCode) ? err.statusCode.toString() : `500`,
				code: err.code ? err.code.toString() : `SERVER_ERROR`,
				title: err.title || `Server Error`,
				detail: err.detail || err.message || ``
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

		res
			.status(statusCode)
			.set(headers)
			.send({
				errors: errors.map(formatError)
			});
	};
};
