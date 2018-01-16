'use strict';

const UnprocessableError = require(`../classes/unprocessable-error`);
const UnsupportedMediaTypeError = require(`../classes/unsupported-media-type-error`);
const {complement, deepFreeze, has, omit} = require(`../../library`);
const querystring = require(`querystring`);

const omitIdAndType = omit([`id`, `type`]);
const hasNot = complement(has);

const contentTypeMap = {
	json: `application/json`,
	jsonApi: `application/vnd.api+json`,
	urlEncoded: `application/x-www-form-urlencoded`
};

function getSupported(options) {
	const types = options.supportedTypes || [`json`, `jsonApi`, `urlEncoded`];
	return types.map((key) => {
		return contentTypeMap[key];
	});
}

module.exports = function parseBody(options = {}) {
	const requireContentType = !options.optionalContentType;
	const supported = getSupported(options);

	function supportedContentType(req, contentType) {
		for (let i = supported.length - 1; i >= 0; i--) {
			if (req.is(supported[i])) {
				return true;
			}
		}
		return false;
	}

	function parseJsonApi(bodyString, req, res, next) {
		if (!bodyString) {
			return next(new UnprocessableError(
				`An empty request body is not valid JSON`
			));
		}

		let body;
		try {
			body = JSON.parse(bodyString);
		} catch (err) {
			return next(new UnprocessableError(
				`JSON parsing error in request body: ${err.message}`
			));
		}

		if (hasNot(`data`, body)) {
			return next(new UnprocessableError(
				`A JSON API request body must contain a 'data' property`,
				{pointer: `/data`}
			));
		}

		req.body = deepFreeze(body);
		next();
	}

	function parseFormUrlEncoded(bodyString, req, res, next) {
		const payload = querystring.parse(bodyString);
		const type = payload.type;
		const attributes = omitIdAndType(payload);

		req.body = deepFreeze({data: {type, attributes}});
		next();
	}

	return function parseBodyMiddleware(req, res, next) {
		const contentType = req.get(`Content-Type`);

		if (requireContentType) {
			if (!contentType) {
				return next(new UnsupportedMediaTypeError(
					`A Content-Type header must be present for a ${req.method} request to ${req.originalUrl}`
				));
			}
			if (!supportedContentType(req, contentType)) {
				return next(new UnsupportedMediaTypeError(
					`Content-Type '${contentType}' is not supported for a ${req.method} request to ${req.originalUrl}`
				));
			}
		}

		req.setEncoding(`utf8`);

		let bodyString = ``;

		req.on(`data`, (chunk) => {
			bodyString += chunk;
		});

		req.on(`end`, () => {
			if (req.is(`json`)) {
				return parseJsonApi(bodyString, req, res, next);
			}
			return parseFormUrlEncoded(bodyString, req, res, next);
		});
	};
};
