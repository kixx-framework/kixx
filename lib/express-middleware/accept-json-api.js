'use strict';

const UnsupportedMediaTypeError = require(`../classes/unsupported-media-type-error`);
const NotAcceptableError = require(`../classes/not-acceptable-error`);
const BadRequestError = require(`../classes/bad-request-error`);
const UnprocessableError = require(`../classes/unprocessable-error`);

const {deepFreeze} = require(`../../library`);
const hasOwn = Object.prototype.hasOwnProperty;

const JSON_API_CONTENT_TYPE = `application/vnd.api+json`;

module.exports = function acceptJsonApi(options = {}) {
	const {allowPlainJson, bodyRequired} = options;

	// For more information on JSON API content negotiation, see the JSON API spec:
	//   http://jsonapi.org/format/#content-negotiation
	function checkContentType(req, res, next) {
		if (!allowPlainJson && !req.accepts(JSON_API_CONTENT_TYPE)) {
			next(new NotAcceptableError(
				`Request client must be able to accept Content-Type "${JSON_API_CONTENT_TYPE}"`
			));
			return true;
		}

		if (!req.accepts(JSON_API_CONTENT_TYPE) && !req.accepts(`json`)) {
			next(new NotAcceptableError(
				`Request client must be able to accept Content-Type "${JSON_API_CONTENT_TYPE}" or "application/json"`
			));
			return true;
		}

		const contentType = req.get(`Content-Type`);

		if (!contentType && bodyRequired) {
			if (bodyRequired) {
				next(new UnprocessableError(
					`A Content-Type header, Content-Length header, and body are required for requests to ${req.originalUrl}`
				));
				return true;
			}
		}

		const isJsonApiContentType = req.is(JSON_API_CONTENT_TYPE);

		if (!isJsonApiContentType && !allowPlainJson) {
			next(new UnsupportedMediaTypeError(
				`Request Content-Type must be "${JSON_API_CONTENT_TYPE}".`
			));
			return true;
		}

		if (!isJsonApiContentType && !req.is(`json`)) {
			next(new UnsupportedMediaTypeError(
				`Request Content-Type must be "${JSON_API_CONTENT_TYPE}" or "application/json".`
			));
			return true;
		}

		// If we are not using the JSON API content type, then we are done.
		if (!isJsonApiContentType) return false;

		const defs = contentType.split(`,`);

		// Check for media type parameters. JSON API does not allow them.
		//  See: http://jsonapi.org/format/#content-negotiation-servers
		for (let i = defs.length - 1; i >= 0; i--) {
			const def = defs[i];
			if (def.startsWith(JSON_API_CONTENT_TYPE) && def.length > JSON_API_CONTENT_TYPE.length) {
				next(new UnsupportedMediaTypeError(
					`Request Content-Type "${JSON_API_CONTENT_TYPE}" must not have any media type parameters.`
				));
				return true;
			}
		}

		return false;
	}

	return function acceptJsonApiMiddleware(req, res, next) {
		// checkContentType() will call next() with an error, or skip if it needs
		// to. If it does call next() it returns true, allowing us to short circuit
		// out here:
		if (checkContentType(req, res, next)) return;

		req.setEncoding(`utf8`);

		let bodyString = ``;

		req.on(`data`, (chunk) => {
			bodyString += chunk;
		});

		req.on(`end`, () => {
			if (!bodyString) {
				return next(new UnprocessableError(
					`An empty request body is not valid JSON`
				));
			}

			let body;
			try {
				body = JSON.parse(bodyString);
			} catch (err) {
				return next(new BadRequestError(
					`JSON parsing error in request body: ${err.message}`
				));
			}

			if (!hasOwn.call(body, `data`)) {
				return next(new UnprocessableError(
					`A JSON API request body must contain a 'data' property`,
					{pointer: `/data`}
				));
			}

			req.body = deepFreeze(body);
			next();
		});
	};
};
