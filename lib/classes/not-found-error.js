'use strict';

class NotFoundError extends Error {
	constructor(message) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `NotFoundError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `NOT_FOUND_ERROR`
			},
			title: {
				enumerable: true,
				value: `Not Found`
			},
			statusCode: {
				enumerable: true,
				value: 404
			},
			detail: {
				enumerable: true,
				value: message
			}
		});

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

module.exports = NotFoundError;
