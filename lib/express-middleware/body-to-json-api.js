'use strict';

const UnprocessableError = require(`../classes/unprocessable-error`);
const {capitalize, curry, deepFreeze, has, isFunction, isObject, isString, omit, prop} = require(`../../library`);

const JSON_API_KEYS = [`id`, `type`, `attributes`, `relationships`, `meta`];

const hasType = has(`type`);
const hasAttributes = has(`attributes`);

// catch options.mapId, options.mapType, options.mapAttributes, or options.mapMeta
const mapper = curry(function getMapper(propName, options) {
	const mapper = options[`map${capitalize(propName)}`];
	if (isFunction(mapper)) return mapper;
	if (isString(mapper)) return prop(mapper);
	return null;
});

module.exports = function bodyToJsonApi(options) {
	options = options || {};

	const mapId = mapper(`id`, options) || prop(`id`);
	const mapType = mapper(`type`, options) || prop(`type`);
	const mapAttributes = mapper(`attributes`, options) || omit(JSON_API_KEYS);
	const mapMeta = mapper(`meta`, options) || prop(`meta`);

	return function bodyToJsonApiMiddleware(req, res, next) {
		const {body} = req;
		if (!body) return next();

		if (hasType(body) && hasAttributes(body)) {
			return next();
		}

		const id = mapId(body);
		const type = mapType(body);
		const attributes = mapAttributes(body) || {};
		const meta = mapMeta(body) || {};

		if (isObject(id)) {
			return next(new UnprocessableError(id.message, {pointer: id.pointer}));
		}
		if (isObject(type)) {
			return next(new UnprocessableError(type.message, {pointer: type.pointer}));
		}

		const data = {type, attributes, meta};

		if (id) data.id = id;

		req.body = deepFreeze({data});
		return next();
	};
};
