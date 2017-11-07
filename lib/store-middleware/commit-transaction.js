'use strict';

const {StackedError} = require(`../../index`);

module.exports = function commitTransaction(api, config) {
	return function commitTransactionMiddleware(args, resolve, reject) {
		return args.transaction.commit().then(() => {
			return resolve(args);
		}, (err) => {
			return reject(
				new StackedError(
					`Error in commitTransaction() store middleware`,
					err,
					commitTransactionMiddleware
				)
			);
		});
	};
};
