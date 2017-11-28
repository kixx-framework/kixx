'use strict';

const ProgrammerError = require(`../classes/programmer-error`);

const {isFullString, path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function resourceGet(options = {}) {
	const {store, type} = options;

	return function ResourceGetController(req, res, next) {
		const {transaction} = req;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`ResourceGetController expects req.params.id string to exist`
			));
		}

		const includeString = req.query.include;
		const include = includeString ? includeString.split(`,`) : [];

		// TODO: Validate include parameter.

		return store.get(transaction, {scope, type, id, include}).then((result) => {
			res.status(200);
			res.locals = result.response;
			return next();
		}).catch(next);
	};
};
