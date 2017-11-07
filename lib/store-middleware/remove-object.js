'use strict';

const {StackedError} = require(`../../index`);
const {assoc} = require(`../../library`);

module.exports = function removeObject(api, config) {
	config = config || {};
	const defaultOptions = config.options || {};

	return function removeObjectMiddleware(args, resolve, reject) {
		const {transaction, scope, type, id} = args;

		const options = Object.assign({}, defaultOptions, args.options);

		return transaction.remove({scope, key: {type, id}, options}).then((res) => {
			// res.data
			// res.meta
			return resolve(assoc(`res`, res, args));
		}, (err) => {
			return reject(
				new StackedError(`Error in removeObject() store middleware`, err, removeObjectMiddleware)
			);
		});
	};
};
