'use strict';

const {deepFreeze} = require(`../../library`);

class MethodNotAllowedError extends Error {
	constructor(message, spec = {}) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `MethodNotAllowedError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `METHOD_NOT_ALLOWED_ERROR`
			},
			title: {
				enumerable: true,
				value: `Method Not Allowed`
			},
			statusCode: {
				enumerable: true,
				value: 405
			},
			detail: {
				enumerable: true,
				value: message
			},
			headers: {
				enumerable: true,
				value: deepFreeze(spec.headers || {})
			}
		});

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

module.exports = MethodNotAllowedError;
