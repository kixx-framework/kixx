'use strict';

module.exports = function composeMiddleware(middleware, callback) {
	function complete(args) {
		return callback(null, args);
	}

	return middleware.slice().reverse().reduce((next, fn) => {
		return function middlewareWrapper(args) {
			let isResolved = false;

			function resolver(val) {
				if (isResolved) return false;
				isResolved = true;
				next(val);
				return null;
			}

			function rejector(err) {
				if (isResolved) return false;
				isResolved = true;
				callback(err, args);
				return null;
			}

			try {
				fn(args, resolver, rejector);
			} catch (err) {
				isResolved = true;
				callback(err, args);
			}
		};
	}, complete);
};
