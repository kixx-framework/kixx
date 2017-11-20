'use strict';

const {StackedError} = require(`../../index`);
const {clone} = require(`../../library`);

module.exports = function getObject(api, config) {
	config = config || Object.create(null);
	const defaultOptions = config.options ? clone(config.options) : Object.create(null);

	return function getObjectMiddleware(args, resolve, reject) {
		const {transaction, scope, parameters} = args;
		const {type, id, include} = parameters;

		const key = {type, id};
		const options = Object.assign({}, defaultOptions, args.options);

		return transaction.get({scope, key, include, options}).then((res) => {
			// res.data Object or null
			// res.included Array
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in getObject() store middleware`, err, getObjectMiddleware)
			);
		});
	};
};
