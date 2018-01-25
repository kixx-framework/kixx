'use strict';

// Used for default middleware where no operation is required.

module.exports = function () {
	return function noop(api, model, args, resolve, reject) {
		return resolve(args);
	};
};
