'use strict';

const uuid = require(`uuid/v1`);

const {isFunction, assoc} = require(`../../library`);

function createUUID() {
	return uuid();
}

module.exports = function () {
	return function generateId(api, model, args, resolve, reject) {
		const createId = isFunction(model.createId) ? model.createId : createUUID;

		return function generateIdMiddleware(args, resolve, reject) {
			const {payload, parameters} = args;

			if (payload.id) return resolve(args);

			const id = createId(args);

			return resolve(
				args.setPayload(assoc(`id`, id, payload)).setParameters(assoc(`id`, id, parameters))
			);
		};
	};
};
