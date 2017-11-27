'use strict';

const {deepFreeze} = require(`../../library`);

class UnauthorizedError extends Error {
	constructor(message, spec = {}) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `UnauthorizedError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `UNAUTHORIZED_ERROR`
			},
			title: {
				enumerable: true,
				value: `Unauthorized`
			},
			statusCode: {
				enumerable: true,
				value: 401
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
	}
}

module.exports = UnauthorizedError;
