'use strict';

class NotAcceptableError extends Error {
	constructor(message, spec = {}) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `NotAcceptableError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `NOT_ACCEPTABLE_ERROR`
			},
			title: {
				enumerable: true,
				value: `Not Acceptable`
			},
			statusCode: {
				enumerable: true,
				value: 406
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

module.exports = NotAcceptableError;
