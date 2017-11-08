'use strict';

module.exports = function emit(api, config) {
	return function emitMiddleware(args, resolve, reject) {
		const {operation, scope, type} = args;

		api.eventBus.broadcast({
			type: `STORE_ACCESS`,
			path: `${operation}:${type}:${scope}`,
			paylaod: args
		});

		return resolve(args);
	};
};
