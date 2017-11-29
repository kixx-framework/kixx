'use strict';

class ConflictError extends Error {
	constructor(message) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `ConflictError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `CONFLICT_ERROR`
			},
			title: {
				enumerable: true,
				value: `Conflict`
			},
			statusCode: {
				enumerable: true,
				value: 409
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

module.exports = ConflictError;
