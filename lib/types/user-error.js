'use strict';

class UserError extends Error {
	constructor(message) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `UserError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `USER_ERROR`
			}
		});

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

module.exports = UserError;
