'use strict';

class NotFoundError extends Error {
	constructor(message, sourceFunction) {
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

module.exports = NotFoundError;
