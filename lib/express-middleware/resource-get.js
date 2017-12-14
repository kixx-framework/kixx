'use strict';

const StackedError = require(`../classes/stacked-error`);
const NotFoundError = require(`../classes/not-found-error`);
const ProgrammerError = require(`../classes/programmer-error`);

const {isNonEmptyString, path, deepFreeze} = require(`../../library`);
const composeLink = require(`../compose-link`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

const composeSelfLink = composeLink((req) => {
	return `${req.baseUrl}${req.path}`;
});

module.exports = function resourceGet(options = {}) {
	const {store, type} = options;

	return function ResourceGetController(req, res, next) {
		const {transaction} = req;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isNonEmptyString(id)) {
			return next(new ProgrammerError(
				`ResourceGetController expects req.params.id string to exist`
			));
		}

		const includeString = req.query.include;
		const include = includeString ? includeString.split(`,`) : [];

		// TODO: Validate include parameter.

		return store.get(transaction, {scope, type, id, include}).then((result) => {
			const {data, meta} = result.response;
			if (!data) {
				return next(new NotFoundError(
					`Resource type: '${type}', id: '${id}' could not be found`
				));
			}

			const links = {
				self: composeSelfLink(req)
			};

			res.status(200);
			res.locals = deepFreeze({data, links, meta});
			next();
			return null;
		}).catch((err) => {
			next(new StackedError(
				`Error in ResourceGetController`,
				err
			));
			return null;
		});
	};
};
