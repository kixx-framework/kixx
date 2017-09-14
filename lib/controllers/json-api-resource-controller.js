'use strict';

const Promise = require(`bluebird`);
const R = require(`ramda`);
const {isNonEmptyString, invariant} = require(`../`);
const Boom = require(`boom`);
const {composeMiddleware} = require(`../namespaces/router`);
const {parseIncludeQuery} = require(`../namespaces/json-api`);
const requestAllowedMethods = require(`../middleware/request-allowed-methods`);
const requestCORS = require(`../middleware/request-cors`);
const requestOptions = require(`../middleware/request-options`);
const requestAuthenticate = require(`../middleware/request-authenticate`);
const requestAuthorize = require(`../middleware/request-authorize`);
const requestAcceptJsonAPI = require(`../middleware/request-accept-json-api`);
const responseCheckEntitlements = require(`../middleware/response-check-entitlements`);
const responseFilterData = require(`../middleware/response-filter-data`);
const responseSendJsonAPI = require(`../middleware/response-send-json-api`);

const METHODS = [
	`OPTIONS`,
	`HEAD`,
	`GET`,
	`PATCH`,
	`DELETE`
];

module.exports = (app, model) => {
	return composeMiddleware(
		requestAllowedMethods(app, {methods: METHODS}),
		requestCORS(app),
		requestOptions(app, {methods: METHODS}),
		requestAuthenticate(app),
		requestAuthorize(app, model),
		requestAcceptJsonAPI(app),
		requestDispatchMethod(app, model),
		responseCheckEntitlements(app, model),
		responseFilterData(app),
		responseSendJsonAPI(app)
	);
};

const requestDispatchMethod = (app, model) => {
	const getJsonApiResource = getResource(app, model);
	const updateJsonApiResource = updateResource(app, model);
	const deleteJsonApiResource = deleteResource(app, model);

	return function dispatchMethod(req, res, next) {
		const method = req.method.toUpperCase();

		switch (method) {
			case `HEAD`:
			case `GET`:
				return getJsonApiResource(req, res, next);
			case `PUT`:
				return updateJsonApiResource(req, res, next);
			case `DELETE`:
				return deleteJsonApiResource(req, res, next);
			default:
				throw new Error(
					`Unexpected HTTP method "${method}" for json-api-resource-controller.`
				);
		}
	};
};

const getResource = (app, model) => {
	const {config, api, logger} = app;

	// TODO: Put scope on the Request instance with authentication info
	const scope = config.scope;

	const type = model.name;

	return function getJsonApiResource(req, res, next) {
		const errors = [];
		const id = req.params.id;
		const include = parseIncludeQuery(req);

		// TODO: Check req.params.id in Middleware
		if (!isNonEmptyString(id)) {
			logger.error(invariant(`getJsonApiResource() is missing req.params.id`));
			errors.push(Boom.badRequest(`Missing required ID parameter in URL`));
		}

		include.forEach((rel) => {
			if (/[.]+/.test(rel)) {
				errors.push(Boom.badRequest(
					`JSON API dot notation for inclusion of nested relationships is not supported.`,
					{source: {parameter: `include`}}
				));
			}
		});

		if (errors.length > 0) {
			return next(errors);
		}

		const params = {
			scope,
			type,
			id,
			include
		};

		return api.db.getResource(params)
			.then((result) => {
				const {resource, included} = result;

				if (!resource) {
					return Promise.reject(Boom.notFound(
						`Resource not found`,
						{detail: `Resource type: ${type}, id: ${id} not found`}
					));
				}

				return next(null, req, res.setData({resource, included}));
			})
			.catch(next);
	};
};

const updateResource = (app, model) => {
	const {config, api, logger} = app;

	// TODO: Put scope on the Request instance with authentication info
	const scope = config.scope;

	const type = model.name;

	return function updateJsonApiResource(req, res, next) {
		const errors = [];
		// TODO: Check payload.data type, id, attributes, relationships
		const {data} = req.payload;
		const {id} = req.params;

		// TODO: Check req.params.id in Middleware
		if (!isNonEmptyString(id)) {
			logger.error(invariant(`getJsonApiResource() is missing req.params.id`));
			errors.push(Boom.badRequest(`Missing required ID parameter in URL`));
		}

		if (data.relationships && Object.keys(data.relationships) > 0) {
			return Promise.reject(Boom.forbidden(
				`Replacing resource relationships in a resource update is not permitted`,
				{
					source: {pointer: `/data/relationships`}
				}
			));
		}

		// TODO: Handle a list of errors.
		if (errors.length > 0) {
			return next(errors);
		}

		const params = {
			scope,
			type,
			id
		};

		return api.db.getResource(params)
			.then((result) => {
				if (!result.resource) {
					// TODO: Detect Not Found error in error handler
					return Promise.reject(Boom.notFound(
						`Resource not found for update`,
						{detail: `Resource type: ${type}, id: ${id} not found`}
					));
				}

				return result.resource;
			})
			.then((resource) => {
				// TODO: How to check entitlements before writing?

				const {attributes, relationships} = resource;

				const params = {
					scope,
					type,
					id,
					attributes: R.mergeDeepRight(attributes, data.attributes),
					relationships
				};

				// TODO: app.api.db automatically updates updatedAt
				params.attributes.updatedAt = new Date().toISOString();

				return api.db.createOrUpdateResource(params);
			})
			.then((resource) => {
				return next(null, req, res.setData({resource}));
			})
			.catch(next);
	};
};

const deleteResource = (app, model) => {
	const {config, api, logger} = app;
	// TODO: Put scope on the Request instance with authentication info
	const scope = config.scope;

	const type = model.name;

	return function deleteJsonApiResource(req, res, next) {
		const id = req.params.id;

		const params = {
			scope,
			type,
			id
		};

		return api.db.getResource(params)
			.then((result) => {
				const {resource} = result;

				if (!resource) {
					logger.debug(`resource does not exist for deletion`, {resource: params});
					return true;
				}

				// TODO: Check entitlements before write.
				return api.db.deleteResource(params);
			})
			.then(() => {
				return next(null, req, res.setData({resource: {type, id}, deleted: true}));
			})
			.catch(next);
	};
};
