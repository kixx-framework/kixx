'use strict';

class ConflictError extends Error {
	constructor(message, sourceFunction) {
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

module.exports = ConflictError;
