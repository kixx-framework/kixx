'use strict';

const ProgrammerError = require(`../classes/programmer-error`);

const {isFullString, path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function resourceRemove(options = {}) {
	const {store, type} = options;

	return function ResourceRemoveController(req, res, next) {
		const {transaction} = req;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`ResourceRemoveController expects req.params.id string to exist`
			));
		}


		return store.remove(transaction, {scope, type, id}).then(() => {
			res.status(204);
			return next();
		}).catch(next);
	};
};
