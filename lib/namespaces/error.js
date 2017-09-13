'use strict';

exports.code = (code, err) => {
	code = validateCode(code);

	return Object.defineProperty(err, `code`, {
		enumerable: true,
		value: code
	});
};

function validateCode(code) {
	switch (code) {
		case `USER_ERROR`:
			return code;
		default:
			throw new TypeError(`Attempting to assign invalid error code: ${code}`);
	}
}
