'use strict';

module.exports = function noop() {
	return function noopMiddleware(args, resolve, reject) {
		return resolve(args);
	};
};
