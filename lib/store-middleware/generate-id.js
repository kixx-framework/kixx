'use strict';

const uuid = require(`uuid/v1`);

const {assoc} = require(`../../library`);

module.exports = function generateId() {
	return function generateIdMiddleware(args, resolve, reject) {
		let payload = args.payload;

		if (payload.id) {
			return resolve(args);
		}

		return resolve(args.setPayload(assoc(
			`id`,
			uuid(),
			payload
		)));
	};
};
