'use strict';

const NotFoundError = require(`../classes/not-found-error`);

module.exports = function handleNotFound() {
	return function handleNotFoundMiddleware(req, res, next) {
		return next(new NotFoundError(`URL route for ${req.originalUrl}`));
	};
};
