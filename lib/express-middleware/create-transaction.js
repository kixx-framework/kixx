'use strict';

module.exports = function createTransaction(create) {
	return function createTransactionMiddleware(req, res, next) {
		req.transaction = create();
		return next();
	};
};
