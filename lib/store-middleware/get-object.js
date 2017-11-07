'use strict';

const {StackedError} = require(`../../index`);
const {assoc} = require(`../../library`);

module.exports = function getObject(api, config) {
	config = config || {};
	const defaultOptions = config.options || {};

	return function getObjectMiddleware(args, resolve, reject) {
		const {transaction, scope, type, id, include} = args;

		const options = Object.assign({}, defaultOptions, args.options || {});

		return transaction.get({scope, key: {type, id}, include, options}).then((res) => {
			// res.data
			// res.included
			// res.meta
			return resolve(assoc(`res`, res, args));
		}, (err) => {
			return reject(
				new StackedError(`Error in getObject() store middleware`, err, getObjectMiddleware)
			);
		});
	};
};
