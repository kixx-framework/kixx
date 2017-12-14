'use strict';

const StackedError = require(`../classes/stacked-error`);
const ProgrammerError = require(`../classes/programmer-error`);
const NotFoundError = require(`../classes/not-found-error`);

const {isFullString, deepFreeze, path} = require(`../../library`);
const composeLink = require(`../compose-link`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

const composeSelfLink = composeLink((req) => {
	return `${req.baseUrl}${req.path}`;
});

module.exports = function relationshipsList(options = {}) {
	const {store, type, relationship} = options;

	return function RelationshipsListController(req, res, next) {
		const {transaction} = req;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`RelationshipsListController expects req.params.id String to exist`
			));
		}

		return store.get(transaction, {scope, type, id})
			.then((result) => {
				const {response} = result;

				if (!response.data) {
					return next(new NotFoundError(
						`Resource type: "${type}" id: "${id}" could not be found`
					));
				}

				const data = (response.data.relationships || {})[relationship] || [];
				const meta = response.meta;
				const links = {
					self: composeSelfLink(req)
				};

				res.status(200);

				res.locals = deepFreeze({
					data,
					links,
					meta
				});

				next();
				return null;
			})
			.catch((err) => {
				next(new StackedError(
					`Error in RelationshipsListController`,
					err
				));
				return null;
			});
	};
};
