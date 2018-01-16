'use strict';

const NotAcceptableError = require(`../classes/not-acceptable-error`);

const JSON_API_CONTENT_TYPE = `application/vnd.api+json`;

module.exports = function acceptJsonApi(options = {}) {
	const {allowPlainJson} = options;

	return function acceptJsonApiMiddleware(req, res, next) {
		// For more information on JSON API content negotiation, see the JSON API spec:
		//   http://jsonapi.org/format/#content-negotiation
		if (!allowPlainJson && !req.accepts(JSON_API_CONTENT_TYPE)) {
			return next(new NotAcceptableError(
				`Request client must be able to accept Content-Type "${JSON_API_CONTENT_TYPE}"`
			));
		}

		if (!req.accepts(JSON_API_CONTENT_TYPE) && !req.accepts(`json`)) {
			return next(new NotAcceptableError(
				`Request client must be able to accept Content-Type "${JSON_API_CONTENT_TYPE}" or "application/json"`
			));
		}

		return next();
	};
};
