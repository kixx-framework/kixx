'use strict';

const StackedError = require(`../../index`);

module.exports = function scanObjects() {
	return function (api, model, args, resolve, reject) {
		const {transaction, scope, parameters, options} = args;
		const {type, cursor, limit} = parameters;

		return transaction.scan({scope, type, cursor, limit, options}).then((res) => {
			// res.data Array
			// res.cursor Object
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in scanObjects() store middleware`, err)
			);
		});
	};
};
