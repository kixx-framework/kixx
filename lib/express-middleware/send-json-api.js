'use strict';

const {assoc} = require(`../../library`);

const assignRelationships = assoc(`relationships`);
const assignData = assoc(`data`);
const assignIncluded = assoc(`included`);

const JSON_API_CONTENT_TYPE = `application/vnd.api+json`;

module.exports = function sendJsonApi(options = {}) {
	const contentType = options.contentType || JSON_API_CONTENT_TYPE;

	return function sendJsonApiMiddleware(req, res, next) {
		// The HTTP status code should already have been set by the controller.

		if (res.locals) {
			let locals = assignData(formatRelationships(res.locals.data), res.locals);
			if (locals.included) {
				locals = assignIncluded(locals.included.map(formatRelationships), locals);
			}
			res.set(`Content-Type`, contentType).send(locals);
		}

		res.send();
	};
};

function formatRelationships(data) {
	const keys = Object.keys(data.relationships || {});
	if (keys.length === 0) return data;

	const relationships = keys.reduce((relationships, key) => {
		relationships[key] = {
			data: data.relationships[key]
		};
		return relationships;
	}, Object.create(null));

	return assignRelationships(relationships, data);
}
