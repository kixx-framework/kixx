'use strict';

const StackedError = require(`../classes/stacked-error`);
const NotFoundError = require(`../classes/not-found-error`);
const ProgrammerError = require(`../classes/programmer-error`);
const BadRequestError = require(`../classes/bad-request-error`);

const {isNonEmptyString, path, deepFreeze} = require(`../../library`);
const composeLink = require(`../compose-link`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

const composeSelfLink = composeLink((req) => {
	return `${req.baseUrl}${req.path}`;
});

function parseIncludeQuery(req) {
	const includeString = req.query.include;
	const include = includeString ? includeString.split(`,`) : [];

	for (let i = include.length - 1; i >= 0; i--) {
		const str = include[i];
		if (isNonEmptyString(str) && /^[\w-]+$/.test(str)) {
			continue;
		}
		return new BadRequestError(
			`Invalid include parameter '${includeString}'`,
			{parameter: `include`}
		);
	}

	return include;
}

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

		const include = parseIncludeQuery(req);
		// parseIncludeQuery() returns an Array or validation Error.
		if (!Array.isArray(include)) {
			const err = include;
			return next(err);
		}

		return store.get(transaction, {scope, type, id, include}).then((result) => {
			const {data, included} = result.response;
			if (!data) {
				return next(new NotFoundError(
					`Resource type: '${type}', id: '${id}' could not be found`
				));
			}

			// Note: results.response has a .meta property, but it is not
			// appropriate for a server response.
			const locals = {
				data,
				meta: {},
				links: {
					self: composeSelfLink(req)
				}
			};

			if (include && include.length > 0) {
				locals.included = included;
			}

			res.status(200);
			res.locals = deepFreeze(locals);
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
