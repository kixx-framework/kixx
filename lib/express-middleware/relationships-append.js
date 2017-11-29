'use strict';

const StackedError = require(`../classes/stacked-error`);
const ProgrammerError = require(`../classes/programmer-error`);
const ForbiddenError = require(`../classes/forbidden-error`);
const NotFoundError = require(`../classes/not-found-error`);
const UnprocessableError = require(`../classes/unprocessable-error`);

const {isFullString, path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

function hasKey(key, items) {
	for (let i = items.length - 1; i >= 0; i--) {
		const {type, id} = items[i];
		if (type === key.type && id === key.id) {
			return true;
		}
	}
	return false;
}

module.exports = function relationshipsAppend(options = {}) {
	const {store, type, relationship, allowAppend} = options;

	return function RelationshipsAppendController(req, res, next) {
		if (!allowAppend) {
			return next(new ForbiddenError(
				`Appending relationship(s) "${relationship}" on type "${type}" is forbidden`
			));
		}

		const {transaction, body} = req;
		const {data} = body;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`RelationshipsAppendController expects req.params.id string to exist`
			));
		}

		if (!Array.isArray(data)) {
			return next(new UnprocessableError(
				`The 'data' property must be an array to append relationships`,
				{pointer: `/data`}
			));
		}

		return store.get(transaction, {scope, type, id})
			.then((result) => {
				const {response} = result;

				if (!response.data) {
					return next(new NotFoundError(
						`Resource type: "${type}" id: "${id}" could not be found`
					));
				}

				// Retrieve a copy of the existing resource identifier objects (keys) for mutation.
				const items = ((response.data.relationships || {})[relationship] || []).slice();

				for (let i = data.length - 1; i >= 0; i--) {
					const key = data[i];
					if (!hasKey(key, items)) {
						items.unshift(key);
					}
				}

				const relationships = Object.create(null);
				relationships[relationship] = items;

				const object = {type, id, relationships};
				return store.update(transaction, {scope, object});
			})
			.then(() => {
				return res.sendStatus(204);
			})
			.catch((err) => {
				return next(new StackedError(
					`Error in RelationshipsAppendController`,
					err
				));
			});
	};
};
