'use strict';

// Used for default middleware where no operation is required.

module.exports = function noop() {
	return function noopMiddleware(args, resolve, reject) {
		return resolve(args);
	};
};
