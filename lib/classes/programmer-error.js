'use strict';

class ProgrammerError extends Error {
	constructor(message, sourceFunction) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `ProgrammerError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `PROGRAMMER_ERROR`
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

module.exports = ProgrammerError;
