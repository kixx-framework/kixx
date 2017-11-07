'use strict';

const {clone} = require(`../../library`);

module.exports = function emit(api, config) {
	return function emitMiddleware(args, resolve, reject) {
		const {operation, scope, type} = args;

		api.events.broadcast(`STORE_ACCESS:${operation}:${type}:${scope}`, {
			type: `STORE_ACCESS`,
			error: false,
			paylaod: clone(args)
		});

		return resolve(args);
	};
};
