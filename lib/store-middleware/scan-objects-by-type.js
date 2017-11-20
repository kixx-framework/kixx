'use strict';

const {StackedError} = require(`../../index`);
const {clone} = require(`../../library`);

module.exports = function scanObjects(api, config) {
	config = config || Object.create(null);
	const defaultOptions = config.options ? clone(config.options) : Object.create(null);

	return function scanObjectsMiddleware(args, resolve, reject) {
		const {transaction, scope, parameters} = args;
		const {type, cursor, limit} = parameters;

		const options = Object.assign({}, defaultOptions, args.options);

		return transaction.scan({scope, type, cursor, limit, options}).then((res) => {
			// res.data Array
			// res.cursor Object
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in scanObjects() store middleware`, err, scanObjectsMiddleware)
			);
		});
	};
};
