'use strict';

const StackedError = require(`../classes/stacked-error`);

const {path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function collectionCreate(options = {}) {
	const {store} = options;

	return function CollectionCreateController(req, res, next) {
		const {transaction, body} = req;
		const scope = getScopeId(req);
		const object = body.data;

		return store.create(transaction, {scope, object}).then((result) => {
			res.status(201);
			res.locals = result.response;
			return next();
		}).catch((err) => {
			return next(new StackedError(
				`Error attempting to create ${object.type} in CollectionCreateController`,
				err
			));
		});
	};
};
