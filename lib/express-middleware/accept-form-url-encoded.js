'use strict';

const UnsupportedMediaTypeError = require(`../classes/unsupported-media-type-error`);
const UnprocessableError = require(`../classes/unprocessable-error`);

const {deepFreeze} = require(`../../library`);

const querystring = require(`querystring`);

const FORM_URL_ENCODED_CONTENT_TYPE = `application/x-www-form-urlencoded`;

module.exports = function (options = {}) {
	const {allowPlainText, bodyRequired} = options;

	// For more information on JSON API content negotiation, see the JSON API spec:
	//   http://jsonapi.org/format/#content-negotiation
	function checkContentType(req, res, next) {
		const contentType = req.get(`Content-Type`);

		if (!contentType && bodyRequired) {
			next(new UnprocessableError(
				`A Content-Type header, Content-Length header, and body are required for requests to ${req.originalUrl}`
			));
			return true;
		}

		const isUrlEncoded = req.is(FORM_URL_ENCODED_CONTENT_TYPE);

		if (!isUrlEncoded && !allowPlainText) {
			next(new UnsupportedMediaTypeError(
				`Request Content-Type must be "${FORM_URL_ENCODED_CONTENT_TYPE}".`
			));
			return true;
		}

		return false;
	}
	return function acceptFormUrlEncodedMiddleware(req, res, next) {
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
			const body = querystring.parse(bodyString);
			req.body = deepFreeze(body);
			next();
		});
	};
};
