'use strict';

const {merge} = require(`../../library`);

module.exports = function mergeObject(api, config) {
	return function mergeObjectMiddleware(args, resolve, reject) {
		const {data} = args.res;

		// If no data has been fetched, then shortcut out.
		if (!data) return resolve(args);

		// Merge attributes.
		// Our merge algorithm creates a new object. It does not mutate the
		// existing objects in any way.
		const attributes = args.attributes ? merge(
			args.attributes,
			data.attributes
		) : data.attributes;

		// Merge relationships.
		// Our merge algorithm creates a new object. It does not mutate the
		// existing objects in any way.
		const relationships = args.relationships ? merge(
			args.relationships,
			data.relationships
		) : data.relationships;

		// Merge attributes and relationships into the arguments, by creating
		// a new args Object.
		return resolve(Object.assign(
			Object.create(null),
			args,
			{attributes, relationships}
		));
	};
};
