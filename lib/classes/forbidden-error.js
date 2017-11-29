'use strict';

class ForbiddenError extends Error {
	constructor(message, spec = {}) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `ForbiddenError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `FORBIDDEN_ERROR`
			},
			title: {
				enumerable: true,
				value: `Forbidden`
			},
			statusCode: {
				enumerable: true,
				value: 403
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

module.exports = ForbiddenError;
