'use strict';

const StackedError = require(`../classes/stacked-error`);
const BadRequestError = require(`../classes/bad-request-error`);

const {path, deepFreeze} = require(`../../library`);
const composeLink = require(`../compose-link`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function collectionList(options = {}) {
	const {store, type} = options;

	return function CollectionListController(req, res, next) {
		const {transaction} = req;
		const scope = getScopeId(req);
		const cursorString = req.query.cursor;
		const limit = parseInt(req.query.limit, 10) || null;

		let cursor;
		if (cursorString) {
			try {
				cursor = JSON.parse(cursorString);
			} catch (err) {
				return next(new BadRequestError(`Invalid scan cursor parameter: "${cursorString}"`, {
					parameter: `cursor`
				}));
			}
		} else {
			cursor = null;
		}

		return store.scan(transaction, {scope, type, limit, cursor}).then((result) => {
			const {data, meta, cursor} = result.response;

			const composeSelfLink = composeLink((req) => {
				return req.originalUrl;
			});

			const composeFirstLink = composeLink((req) => {
				const path = `${req.baseUrl}${req.path}`;
				if (limit) {
					const limitParam = encodeURIComponent(`page[limit]=${limit}`);
					return `${path}?${limitParam}`;
				}
				return path;
			});

			const composeNextLink = composeLink((req) => {
				const cursorParam = encodeURIComponent(`page[cursor]=${JSON.stringify(cursor)}`);
				let path = `${req.baseUrl}${req.path}?${cursorParam}`;
				if (limit) {
					const limitParam = encodeURIComponent(`page[limit]=${limit}`);
					path = `${path}&${limitParam}`;
				}
				return path;
			});

			const links = {
				self: composeSelfLink(req),
				first: composeFirstLink(req),
				last: null,
				previous: null,
				next: composeNextLink(req)
			};

			res.status(200);
			res.locals = deepFreeze({data, links, meta});

			next();
			return null;
		}).catch((err) => {
			next(new StackedError(
				`Error attempting to list ${type} in CollectionListController`,
				err
			));
			return null;
		});
	};
};

