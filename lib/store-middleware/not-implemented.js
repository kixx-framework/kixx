'use strict';

const {NotImplementedError} = require(`../../index`);

module.exports = function (name) {
	name = name || `ANONYMOUS`;
	return function notImplemented(api, model, args, resolve, reject) {
		return reject(new NotImplementedError(`No store middleware implemented for '${name}'`));
	};
};
