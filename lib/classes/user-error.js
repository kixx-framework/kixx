'use strict';

class UserError extends Error {
	constructor(message, sourceFunction) {
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
			if (sourceFunction) {
				Error.captureStackTrace(this, sourceFunction);
			} else {
				Error.captureStackTrace(this, this.constructor);
			}
		}
	}
}

module.exports = UserError;
