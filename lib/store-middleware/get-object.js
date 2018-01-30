'use strict';

const {StackedError} = require(`../../`);

module.exports = function getObject() {
	return function (api, model, args, resolve, reject) {
		const {transaction, scope, parameters, options} = args;
		const {type, id, include} = parameters;

		if (!id) {
			return resolve(args.setResponse({data: null, meta: {notFound: true}}));
		}

		const key = {type, id};

		return transaction.get({scope, key, include, options}).then((res) => {
			// res.data Object or null
			// res.included Array
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in getObject() store middleware`, err)
			);
		});
	};
};
