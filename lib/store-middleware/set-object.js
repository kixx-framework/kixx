'use strict';

const {StackedError} = require(`../../index`);
const {assoc} = require(`../../library`);

module.exports = function setObject(api, config) {
	config = config || {};
	const defaultOptions = config.options || {};

	return function setObjectMiddleware(args, resolve, reject) {
		const {transaction, scope, type, id, attributes, relationships} = args;
		const object = {type, id, attributes, relationships};

		const options = Object.assign({}, defaultOptions, args.options || {});

		return transaction.set({scope, object, options}).then((res) => {
			// res.data
			// res.meta
			return resolve(assoc(`res`, res, args));
		}, (err) => {
			return reject(
				new StackedError(`Error in setObject() store middleware`, err, setObjectMiddleware)
			);
		});
	};
};
