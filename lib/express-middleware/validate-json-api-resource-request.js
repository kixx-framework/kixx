'use strict';

const UnprocessableError = require(`../classes/unprocessable-error`);
const ProgrammerError = require(`../classes/programmer-error`);

const {isObject, isNonEmptyString, deepFreeze} = require(`../../library`);

module.exports = function validateJsonApiResourceRequest(options = {}) {
	const expectedType = options.type;

	return function validateJsonApiResourceRequestMiddleware(req, res, next) {
		if (!req.body || !req.body.data) {
			return next(new ProgrammerError(
				`validateJsonApiResourceRequest() middleware expects req.body.data to be present`
			));
		}

		// TODO: Detect extra keys.

		if (!isObject(req.body.data)) {
			return next(new UnprocessableError(
				`Request 'data' property must be a JSON object`,
				{pointer: `/data`}
			));
		}

		let data = req.body.data;
		const {type} = data;

		if (!isNonEmptyString(type)) {
			return next(new UnprocessableError(
				`Request 'data.type' property must be a JSON string`,
				{pointer: `/data/type`}
			));
		}

		if (type !== expectedType) {
			return next(new UnprocessableError(
				`Request data.type '${type}' does not match expected type '${expectedType}' in ${req.originalUrl}`,
				{pointer: `/data/type`}
			));
		}

		const attributes = data.attributes || Object.create(null);
		const relationships = data.relationships || Object.create(null);
		const meta = data.meta || Object.create(null);

		data = Object.assign(
			Object.create(null),
			data,
			{attributes, relationships, meta}
		);

		req.body = deepFreeze(Object.assign(
			Object.create(null),
			{meta: Object.create(null)},
			req.body,
			{data}
		));

		return next();
	};
};
