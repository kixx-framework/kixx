'use strict';

class BadRequestError extends Error {
	constructor(message, spec = {}) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `BadRequestError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `BAD_REQUEST_ERROR`
			},
			title: {
				enumerable: true,
				value: `Bad Request`
			},
			statusCode: {
				enumerable: true,
				value: 400
			},
			detail: {
				enumerable: true,
				value: message
			},
			parameter: {
				enumerable: true,
				value: spec.parameter
			}
		});
	}
}

module.exports = BadRequestError;
