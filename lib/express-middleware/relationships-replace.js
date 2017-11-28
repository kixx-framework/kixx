'use strict';

const ProgrammerError = require(`../classes/programmer-error`);
const ForbiddenError = require(`../classes/forbidden-error`);
const NotFoundError = require(`../classes/not-found-error`);

const {isFullString, path} = require(`../../library`);

// The scope is attached to req.scope.id
const getScopeId = path([`scope`, `id`]);

module.exports = function relationshipsReplace(options = {}) {
	const {store, type, relationship, allowReplace} = options;

	return function RelationshipsReplaceController(req, res, next) {
		if (!allowReplace) {
			return next(new ForbiddenError(
				`Replacing relationship "${relationship}" on type "${type}" is forbidden`
			));
		}

		const {transaction, body} = req;
		const {data} = body;
		const scope = getScopeId(req);
		const {id} = req.params;

		if (!isFullString(id)) {
			return next(new ProgrammerError(
				`RelationshipsReplaceController expects req.params.id String to exist`
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

				const relationships = Object.create(null);
				relationships[relationship] = data;

				// TODO: Make sure all the referenced resources exist.

				const object = {
					type,
					id,
					relationships
				};

				return store.update(transaction, {scope, object});
			})
			.then((result) => {
				res.status(200);
				res.locals = result.response;
				return next();
			})
			.catch(next);
	};
};
