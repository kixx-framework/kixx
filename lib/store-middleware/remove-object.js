'use strict';

const {StackedError} = require(`../../index`);

module.exports = function removeObject() {
	return function (api, model, args, resolve, reject) {
		const {transaction, scope, parameters, options} = args;
		const {type, id} = parameters;

		const key = {type, id};

		return transaction.remove({scope, key, options}).then((res) => {
			// res.data Boolean
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in removeObject() store middleware`, err)
			);
		});
	};
};
