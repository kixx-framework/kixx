'use strict';

class StackedError extends Error {
	constructor(message, err, sourceFunction) {
		super(message);

		let errors = [];

		if (err && Array.isArray(err.errors)) {
			errors = err.errors;
			errors.push(err);
		} else if (err) {
			errors = Array.isArray(err) ? err : [err];
		}

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `StackedError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: (errors[0] || {}).code
			},
			errors: {
				enumerable: true,
				value: errors
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

module.exports = StackedError;
