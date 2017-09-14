'use strict';

const R = require(`ramda`);
const {isString, isArray, isNonEmptyString} = require(`./`);
const pluralize = require(`pluralize`);
const UserError = require(`./types/user-error`);
const handleError = require(`./controllers/handle-error`);
const handleNotFound = require(`./controllers/handle-not-found`);
const resourceController = require(`./controllers/resource-controller`);
const listController = require(`./controllers/list-controller`);
const jsonApiResourceController = require(`./controllers/json-api-resource-controller`);
const jsonApiListController = require(`./controllers/json-api-list-controller`);
const jsonApiRelationshipController = require(`./controllers/json-api-relationship-controller`);

const RESOURCE_ALLOWED_METHODS = [
	`GET`
];

const LIST_ALLOWED_METHODS = [
	`GET`
];

module.exports = (app, router) => {
	const routes = app.config.routes || [];
	const models = app.config.models || {};

	router = router
		.addErrorHandler(handleError(app))
		.addNotFoundHandler(handleNotFound(app));

	router = routes.reduce(createRoute(app), router);

	const modelList = Object.keys(models).map((k) => {
		return R.assoc(`name`, k, models[k]);
	});

	router = modelList.reduce(createJsonApiRoute(app), router);

	return router;
};

const createRoute = R.curry((app, router, route, i) => {
	route = route || {};

	const {
		methods,
		pattern,
		controller,
		type,
		id,
		template
	} = route;

	if (!isArray(methods)) {
		throw new UserError(
			`Route at index ${i} does not have a methods Array.`
		);
	}

	if (!isNonEmptyString(pattern)) {
		throw new UserError(
			`Route at index ${i} does not have a pattern string.`
		);
	}

	if (!isNonEmptyString(controller)) {
		throw new UserError(
			`Route at index ${i} does not have a controller string.`
		);
	}

	if (type && !isString(type)) {
		throw new UserError(
			`Route at index ${i} contains truthy non-string type.`
		);
	}

	if (id && !isString(id)) {
		throw new UserError(
			`Route at index ${i} contains truthy non-string id.`
		);
	}

	let handler;

	switch (controller) {
		case `resource`:
			handler = resourceController(
				app,
				{type, id},
				validateMethods(RESOURCE_ALLOWED_METHODS, i, methods),
				template
			);
			break;
		case `list`:
			handler = listController(
				app,
				{type},
				validateMethods(LIST_ALLOWED_METHODS, i, methods),
				template
			);
			break;
		default:
			throw new UserError(
				`Route at index ${i} has invalid controller "${controller}"`
			);
	}

	return router.route(pattern, handler);
});

const createJsonApiRoute = R.curry((app, router, model) => {
	const type = model.name;
	const pluralType = pluralize.plural(type);

	const routes = [
		{
			pattern: `/jsonapi/${pluralType}/:id/relationships/:relationship`,
			handler: jsonApiRelationshipController(app, model)
		},
		{
			pattern: `/jsonapi/${pluralType}/:id`,
			handler: jsonApiResourceController(app, model)
		},
		{
			pattern: `/jsonapi/${pluralType}`,
			handler: jsonApiListController(app, model)
		}
	];

	return routes.reduce((router, route) => {
		const {pattern, handler} = route;
		return router.route(pattern, handler);
	});
});

function validateMethods(allowed, index, methods) {
	methods.forEach((method, y) => {
		if (!isNonEmptyString(method)) {
			throw new UserError(
				`Route at index ${index} has invalid method at index ${y}.`
			);
		}

		if (!allowed.includes(method.toUpperCase())) {
			throw new UserError(
				`Route at index ${index} has unrecognized method ${method}.`
			);
		}
	});

	return methods.map((method) => method.toUpperCase());
}
