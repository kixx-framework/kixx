'use strict';

const mergeStoreRecords = require(`../merge-store-records`);

module.exports = function () {
	return function mergeObject(api, model, args, resolve, reject) {
		// If no data has been fetched, then shortcut out.
		if (!args.response || !args.response.data) return resolve(args);

		// If there is no assigned payload, then shortcut out.
		if (!args.payload || !args.payload.type || !args.payload.id) {
			return resolve(args.setPayload(args.response.data));
		}

		const {data} = args.response;

		// Our merge algorithm creates a new object. It does not mutate the
		// existing objects in any way.
		const payload = mergeStoreRecords(
			data,
			args.payload
		);

		// Merge attributes and relationships into the arguments, by creating
		// a new args Object.
		return resolve(args.setPayload(payload));
	};
};
