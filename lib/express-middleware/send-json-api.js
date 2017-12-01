'use strict';

const JSON_API_CONTENT_TYPE = `application/vnd.api+json`;

module.exports = function sendJsonApi(options = {}) {
	const contentType = options.contentType || JSON_API_CONTENT_TYPE;

	return function sendJsonApiMiddleware(req, res, next) {
		// Status code should already have been set by the controller.
		// res.status(statusCode);

		if (res.locals) {
			res.set(`Content-Type`, contentType).send(res.locals);
		}

		res.send();
	};
};
