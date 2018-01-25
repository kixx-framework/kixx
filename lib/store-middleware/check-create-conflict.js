'use strict';

const ConflictError = require(`../classes/conflict-error`);

module.exports = function () {
	return function checkCreateConflict(api, model, args, resolve, reject) {
		// If the resource (data) already exists, then we have a ConflictError.
		if (args.response && args.response.data) {
			const {type, id} = args.response.data;
			return reject(new ConflictError(
				`Resource '${type}' : '${id}' already exists and cannot be created`
			));
		}
		return resolve(args);
	};
};
