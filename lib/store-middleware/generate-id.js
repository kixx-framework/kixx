'use strict';

const uuid = require(`uuid/v1`);

const {isFunction, assoc} = require(`../../library`);

function createUUID() {
	return uuid();
}

module.exports = function generateId(api, config) {
	const createId = isFunction(config.createId) ? config.createId : createUUID;

	return function generateIdMiddleware(args, resolve, reject) {
		const {payload, parameters} = args;

		if (payload.id) return resolve(args);

		const id = createId(args);

		return resolve(
			args.setPayload(assoc(`id`, id, payload)).setParameters(assoc(`id`, id, parameters))
		);
	};
};
