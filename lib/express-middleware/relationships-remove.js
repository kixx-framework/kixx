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

module.exports = function relationshipsRemove(options = {}) {
	const {store, type, relationship, allowRemove} = options;

	return function RelationshipsRemoveController(req, res, next) {
		if (!allowRemove) {
			return next(new ForbiddenError(
				`Removing relationship(s) "${relationship}" on type "${type}" is forbidden`
			));
		}

		const {transaction, body} = req;
		const {data} = body;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`RelationshipsRemoveController expects req.params.id string to exist`
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

				const items = (response.data.relationships || {})[relationship] || [];
				const relationships = Object.create(null);
				relationships[relationship] = items.filter((key) => {
					return !hasKey(key, data);
				});

				const object = {type, id, relationships};
				return store.update(transaction, {scope, object});
			})
			.then(() => {
				res.sendStatus(204);
				return null;
			})
			.catch((err) => {
				next(new StackedError(
					`Error in RelationshipsRemoveController`,
					err
				));
				return null;
			});
	};
};
