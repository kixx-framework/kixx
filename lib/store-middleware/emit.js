'use strict';

module.exports = function emit(api, config) {
	return function emitMiddleware(args, resolve, reject) {
		const {operation, scope, type, id, attributes, relationships} = args;

		api.events.broadcast(`STORE_ACCESS:${operation}:${type}:${scope}`, {
			type: `STORE_ACCESS`,
			error: false,
			paylaod: {operation, scope, type, id, attributes, relationships}
		});

		return resolve(args);
	};
};
