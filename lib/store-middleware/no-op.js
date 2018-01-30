'use strict';

// Used for default middleware where no operation is required.

module.exports = function noop() {
	return function (api, model, args, resolve, reject) {
		return resolve(args);
	};
};
