'use strict';

const {merge} = require(`../../library`);

module.exports = function mergeObject(api, config) {
	return function mergeObjectMiddleware(args, resolve, reject) {
		const {data} = args.res;

		if (!data) return resolve(args);

		const attributes = args.attributes ? merge(
			args.attributes,
			data.attributes
		) : data.attributes;

		const relationships = args.relationships ? merge(
			args.relationships,
			data.relationships
		) : data.relationships;

		return resolve(Object.assign(
			Object.create(null),
			args,
			{attributes, relationships}
		));
	};
};
