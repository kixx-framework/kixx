'use strict';

const {StackedError} = require(`../../index`);
const {clone} = require(`../../library`);

module.exports = function removeObject(api, config) {
	config = config || Object.create(null);
	const defaultOptions = config.options ? clone(config.options) : Object.create(null);

	return function removeObjectMiddleware(args, resolve, reject) {
		const {transaction, scope, parameters} = args;
		const {type, id} = parameters;

		const key = {type, id};
		const options = Object.assign({}, defaultOptions, args.options);

		return transaction.remove({scope, key, options}).then((res) => {
			// res.data Boolean
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in removeObject() store middleware`, err, removeObjectMiddleware)
			);
		});
	};
};
