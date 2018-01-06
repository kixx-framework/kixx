'use strict';

const BadRequestError = require(`../classes/bad-request-error`);
const UnprocessableError = require(`../classes/unprocessable-error`);
const ProgrammerError = require(`../classes/programmer-error`);

const {complement, deepFreeze, isObject, isString, difference, isEmpty, isNonEmptyString} = require(`../../library`);

const isNotObject = complement(isObject);
const isNotString = complement(isString);

const ALLOWED_BODY_KEYS = [
	`data`,
	`meta`,
	`jsonapi`,
	`links`
];

const ALLOWED_DATA_KEYS = [
	`type`,
	`id`,
	`attributes`,
	`relationships`,
	`links`,
	`meta`
];

module.exports = function validateJsonApiResourceRequest(options = {}) {
	const expectedType = options.type;

	return function validateJsonApiResourceRequestMiddleware(req, res, next) {
		if (isEmpty(req.body)) {
			return next(new ProgrammerError(
				`validateJsonApiResourceRequest() middleware expects req.body to be present`
			));
		}

		if (difference(Object.keys(req.body), ALLOWED_BODY_KEYS).length > 0) {
			return next(new BadRequestError(
				`Request body must only have keys ${ALLOWED_BODY_KEYS.join()}`,
				{parameter: `body`}
			));
		}

		if (isNotObject(req.body.data)) {
			return next(new UnprocessableError(
				`Request data Object must be present`,
				{pointer: `/data`}
			));
		}

		let data = req.body.data;

		if (difference(Object.keys(data), ALLOWED_DATA_KEYS).length > 0) {
			return next(new UnprocessableError(
				`Request data Object must only have keys ${ALLOWED_DATA_KEYS.join()}`,
				{pointer: `/data`}
			));
		}

		const {type, id} = data;

		if (!isNonEmptyString(type)) {
			return next(new UnprocessableError(
				`Request data.type property must be present`,
				{pointer: `/data/type`}
			));
		}

		if (type !== expectedType) {
			return next(new UnprocessableError(
				`Request data.type '${type}' does not match expected type '${expectedType}' in ${req.originalUrl}`,
				{pointer: `/data/type`}
			));
		}

		if (id && isNotString(id)) {
			return next(new UnprocessableError(
				`If data.id property is present it must be a String`,
				{pointer: `/data/id`}
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
