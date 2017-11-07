'use strict';

const {NotImplementedError} = require(`../../index`);

module.exports = function notImplemented(api, config) {
	const {name} = config;

	return function notImplementedMiddleware(args, resolve, reject) {
		return reject(new NotImplementedError(`No store middleware implemented for ${name}`));
	};
};
