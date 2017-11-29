'use strict';

const StackedError = require(`../classes/stacked-error`);

const {path, deepFreeze} = require(`../../library`);
const composeLink = require(`../compose-link`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function collectionCreate(options = {}) {
	const {store} = options;

	return function CollectionCreateController(req, res, next) {
		const {transaction, body} = req;
		const scope = getScopeId(req);
		const object = body.data;

		return store.create(transaction, {scope, object}).then((result) => {
			const {data, meta} = result.response;

			const composeSelfLink = composeLink((req) => {
				const path = `${req.baseUrl}${req.path}`;
				return path.endsWith(`/`) ? path + data.id : `${path}/${data.id}`;
			});

			const links = {
				self: composeSelfLink(req)
			};

			res.status(201);
			res.locals = deepFreeze({data, links, meta});

			return next();
		}).catch((err) => {
			return next(new StackedError(
				`Error attempting to create ${object.type} in CollectionCreateController`,
				err
			));
		});
	};
};
