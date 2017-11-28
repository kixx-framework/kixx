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

	return function acceptJsonApiMiddleware(req, res, next) {
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

		const contentType = req.get(`Content-Type`);

		if (!contentType) {
			if (bodyRequired) {
				return next(new UnprocessableError(
					`A Content-Type header, Content-Length header, and body are required for requests to ${req.originalUrl}`
				));
			}
			return next();
		}

		// TODO: Handle content negotiation closer to the specification:
		//   http://jsonapi.org/format/#content-negotiation

		const isJsonApiContentType = req.is(JSON_API_CONTENT_TYPE);

		if (!isJsonApiContentType && !allowPlainJson) {
			return next(new UnsupportedMediaTypeError(
				`Request Content-Type must be "${JSON_API_CONTENT_TYPE}".`
			));
		}

		if (!isJsonApiContentType && !req.is(`json`)) {
			return next(new UnsupportedMediaTypeError(
				`Request Content-Type must be "${JSON_API_CONTENT_TYPE}" or "application/json".`
			));
		}

		// TODO: Deny requests with content body but no Content-Type header.

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
