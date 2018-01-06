'use strict';

const BadRequestError = require(`../classes/bad-request-error`);
const UnprocessableError = require(`../classes/unprocessable-error`);
const ProgrammerError = require(`../classes/programmer-error`);

const {difference, isEmpty, isObject, isNonEmptyString, deepFreeze} = require(`../../library`);

const ALLOWED_BODY_KEYS = [
	`data`,
	`meta`,
	`jsonapi`,
	`links`
];

module.exports = function validateJsonApiRelationshipsRequest() {
	return function validateJsonApiRelationshipsRequestMiddleware(req, res, next) {
		if (isEmpty(req.body)) {
			return next(new ProgrammerError(
				`validateJsonApiRelationshipsRequest() middleware expects req.body to be present`
			));
		}

		if (difference(Object.keys(req.body), ALLOWED_BODY_KEYS).length > 0) {
			return next(new BadRequestError(
				`Request body must only have keys ${ALLOWED_BODY_KEYS.join()}`,
				{parameter: `body`}
			));
		}

		const data = req.body.data;

		if (Array.isArray(data)) {
			for (let i = data.length - 1; i >= 0; i--) {
				const key = data[i];
				if (!isNonEmptyString(key.type)) {
					return next(new UnprocessableError(
						`Request 'data[i].type' property must be a JSON string when 'data' is an array of resource identifier objects`,
						{pointer: `/data`}
					));
				}
				if (!isNonEmptyString(key.id)) {
					return next(new UnprocessableError(
						`Request 'data[i].id' property must be a JSON string when 'data' is an array of resource identifier objects`,
						{pointer: `/data`}
					));
				}
			}
		} else if (isObject(data)) {
			if (!isNonEmptyString(data.type)) {
				return next(new UnprocessableError(
					`Request 'data.type' property must be a JSON string when 'data' is an object`,
					{pointer: `/data/type`}
				));
			}
			if (!isNonEmptyString(data.id)) {
				return next(new UnprocessableError(
					`Request 'data.id' property must be a JSON string when 'data' is an object`,
					{pointer: `/data/id`}
				));
			}
		} else if (data !== null) {
			return next(new UnprocessableError(
				`Request 'data' property must be a JSON array, object, or null`,
				{pointer: `/data`}
			));
		}

		req.body = deepFreeze(Object.assign(
			Object.create(null),
			{meta: Object.create(null)},
			req.body
		));

		return next();
	};
};
