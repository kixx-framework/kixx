'use strict';

const {NotImplementedError} = require(`../../index`);

module.exports = function notImplemented(name) {
	name = name || `ANONYMOUS`;

	return function (api, model, args, resolve, reject) {
		return reject(new NotImplementedError(`No store middleware implemented for '${name}'`));
	};
};
