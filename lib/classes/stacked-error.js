'use strict';

const {EOL} = require(`os`);

class StackedError extends Error {
	constructor(message, err, sourceFunction) {
		let errors = [];

		if (err && Array.isArray(err.errors)) {
			errors = err.errors.slice();
			errors.unshift(err);
		} else if (err) {
			errors = Array.isArray(err) ? err : [err];
		}

		message = `${message}: ${errors[0].message}`;

		super(message);

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
				value: (errors[0] || {}).code || `GENERIC_STACKED_ERROR`
			},
			errors: {
				enumerable: true,
				value: Object.freeze(errors)
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

	static getFullStack(err) {
		let errors = [err];
		if (err.errors) {
			errors = errors.concat(err.errors);
		}
		return errors.map((err) => err.stack).join(`${EOL}caused by:${EOL}`);
	}
}

module.exports = StackedError;
