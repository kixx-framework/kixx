'use strict';

const StackedError = require(`../classes/stacked-error`);
const ProgrammerError = require(`../classes/programmer-error`);
const NotFoundError = require(`../classes/not-found-error`);

const {isNonEmptyString, deepFreeze} = require(`../../library`);

module.exports = function authenticateScope(options = {}) {
	const {store, isGlobal} = options;
	const type = isNonEmptyString(options.type) ? options.type : `scope`;

	return function authenticateScopeMiddleware(req, res, next) {
		const {transaction} = req;
		const scopeId = req.params.scope;
		if (!isNonEmptyString(scopeId) && !isGlobal) {
			return next(new ProgrammerError(
				`authenticateScopeMiddleware() requires a valid ':scope' req parameter`
			));
		}

		return store.get(transaction, {type, id: scopeId}).then((result) => {
			const {response} = result;
			if (!response.data) {
				return next(new NotFoundError(
					`Unable to find ${type} record '${scopeId}' as request scope`
				));
			}

			req.scope = deepFreeze(response.data);
			next();
			return null;
		}).catch((err) => {
			return next(new StackedError(
				`Error attempting to fetch ${type} in authenticateScopeMiddleware()`,
				err
			));
		});
	};
};
