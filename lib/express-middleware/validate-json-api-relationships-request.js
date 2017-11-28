'use strict';

const UnprocessableError = require(`../classes/unprocessable-error`);
const ProgrammerError = require(`../classes/programmer-error`);

const {isObject, isNonEmptyString, deepFreeze} = require(`../../library`);
const hasOwn = Object.prototype.hasOwnProperty;

module.exports = function validateJsonApiRelationshipsRequest() {
	return function validateJsonApiRelationshipsRequestMiddleware(req, res, next) {
		if (!req.body || !hasOwn.call(req.body, `data`)) {
			return next(new ProgrammerError(
				`validateJsonApiResourceRequest() middleware expects req.body.data to be present`
			));
		}

		// TODO: Detect extra keys.

		const data = req.body.data;

		if (Array.isArray(data)) {
			for (let i = data.length - 1; i >= 0; i--) {
				const key = data[i];
				if (!isNonEmptyString(key.type)) {
					return next(new UnprocessableError(
						`Request 'data[i].type' property must be a JSON string when 'data' is an array of resource identifier objects`
					));
				}
				if (!isNonEmptyString(key.id)) {
					return next(new UnprocessableError(
						`Request 'data[i].id' property must be a JSON string when 'data' is an array of resource identifier objects`
					));
				}
			}
		} else if (isObject(data)) {
			if (!isNonEmptyString(data.type)) {
				return next(new UnprocessableError(
					`Request 'data.type' property must be a JSON string when 'data' is an object`
				));
			}
			if (!isNonEmptyString(data.id)) {
				return next(new UnprocessableError(
					`Request 'data.id' property must be a JSON string when 'data' is an object`
				));
			}
		} else if (data !== null) {
			return next(new UnprocessableError(
				`Request 'data' property must be a JSON array, object, or null`
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
