'use strict';

const mergeStoreRecords = require(`../merge-store-records`);

module.exports = function mergeObject(api, config) {
	return function mergeObjectMiddleware(args, resolve, reject) {

		// If no data has been fetched, then shortcut out.
		if (!args.res || !args.res.data) return resolve(args);

		const {data} = args.res;

		// Our merge algorithm creates a new object. It does not mutate the
		// existing objects in any way.
		const {attributes, relationships, meta} = mergeStoreRecords(data, args);

		// Merge attributes and relationships into the arguments, by creating
		// a new args Object.
		return resolve(Object.assign(
			Object.create(null),
			args,
			{attributes, relationships, meta}
		));
	};
};
