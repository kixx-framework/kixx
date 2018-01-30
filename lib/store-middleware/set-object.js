'use strict';

const {StackedError} = require(`../../index`);

module.exports = function setObject() {
	return function (api, model, args, resolve, reject) {
		const {transaction, scope, payload, options} = args;

		return transaction.set({scope, object: payload, options}).then((res) => {
			// res.data Object
			// res.meta OBject
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in setObject() store middleware`, err)
			);
		});
	};
};
