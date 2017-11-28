'use strict';

const {path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function createCreateController(options = {}) {
	const {store} = options;

	return function collectionCreate(req, res, next) {
		const {transaction, body} = req;
		const scope = getScopeId(req);
		const object = body.data;

		return store.create(transaction, {scope, object}).then((result) => {
			res.status(201);
			res.locals = result.response;
			return next();
		}).catch(next);
	};
};
