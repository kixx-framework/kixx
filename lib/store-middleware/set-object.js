'use strict';

const {StackedError} = require(`../../index`);
const {clone, assoc} = require(`../../library`);
const uuid = require(`uuid/v1`);

module.exports = function setObject(api, config) {
	config = config || Object.create(null);
	const defaultOptions = config.options ? clone(config.options) : Object.create(null);

	return function setObjectMiddleware(args, resolve, reject) {
		const {transaction, scope} = args;
		let payload = args.payload;

		if (!payload.id) {
			payload = assoc(`id`, uuid(), payload);
		}

		const options = Object.assign({}, defaultOptions, args.options);

		return transaction.set({scope, object: payload, options}).then((res) => {
			// res.data Object
			// res.meta OBject
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in setObject() store middleware`, err, setObjectMiddleware)
			);
		});
	};
};
