'use strict';

class UnsupportedMediaTypeError extends Error {
	constructor(message, spec = {}) {
		super(message);

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: `UnsupportedMediaTypeError`
			},
			message: {
				enumerable: true,
				value: message
			},
			code: {
				enumerable: true,
				value: `UNSUPPORTED_MEDIA_TYPE_ERROR`
			},
			title: {
				enumerable: true,
				value: `Unsupported Media Type`
			},
			statusCode: {
				enumerable: true,
				value: 415
			},
			detail: {
				enumerable: true,
				value: message
			}
		});
	}
}

module.exports = UnsupportedMediaTypeError;
