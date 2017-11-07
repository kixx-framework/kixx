'use strict';

const {StackedError} = require(`../../index`);
const {assoc} = require(`../../library`);

module.exports = function scanObjects(api, config) {
	config = config || {};
	const defaultOptions = config.options || {};

	return function scanObjectsMiddleware(args, resolve, reject) {
		const {transaction, scope, type, cursor, limit} = args;

		const options = Object.assign({}, defaultOptions, args.options);

		return transaction.get({scope, type, cursor, limit, options}).then((res) => {
			// res.data
			// res.cursor
			// res.meta
			return resolve(assoc(`res`, res, args));
		}, (err) => {
			return reject(
				new StackedError(`Error in scanObjects() store middleware`, err, scanObjectsMiddleware)
			);
		});
	};
};
