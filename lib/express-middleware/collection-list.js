'use strict';

const BadRequestError = require(`../classes/bad-request-error`);

const {path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function collectionList(options = {}) {
	const {store, type} = options;

	return function collectionListController(req, res, next) {
		const {transaction} = req;
		const scope = getScopeId(req);
		const cursorString = req.query.cursor;

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

		// TODO: Validate the cursor

		return store.scan(transaction, {scope, type, cursor}).then((result) => {
			res.status(200);
			res.locals = result.response;
			return next();
		}).catch(next);
	};
};

