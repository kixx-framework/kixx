'use strict';

const StackedError = require(`../classes/stacked-error`);
const ProgrammerError = require(`../classes/programmer-error`);
const UnprocessableError = require(`../classes/unprocessable-error`);
const ForbiddenError = require(`../classes/forbidden-error`);

const {isFullString, path, deepFreeze} = require(`../../library`);
const composeLink = require(`../compose-link`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

const composeSelfLink = composeLink((req) => {
	return `${req.baseUrl}${req.path}`;
});

module.exports = function resourceUpdate(options = {}) {
	const {store} = options;

	return function ResourceUpdateController(req, res, next) {
		const {transaction, body} = req;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`ResourceUpdateController expects req.params.id string to exist`
			));
		}

		const object = body.data;

		if (object.id !== id) {
			return next(new UnprocessableError(
				`Request 'data.id' "${object.id}" does not match expected type "${id}" in ${req.originalUrl}`,
				{pointer: `/data/id`}
			));
		}

		if (object.relationships) {
			return next(new ForbiddenError(
				`Relationships must be updated using a /TYPE/ID/relationships/RELATIONSHIP endpoint.`
			));
		}

		return store.update(transaction, {scope, object}).then((result) => {
			const {data, meta} = result.response;

			const links = {
				self: composeSelfLink(req)
			};

			res.status(200);
			res.locals = deepFreeze({data, links, meta});
			return next();
		}).catch((err) => {
			return next(new StackedError(
				`Error in ResourceUpdateController`,
				err
			));
		});
	};
};
