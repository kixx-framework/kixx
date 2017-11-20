'use strict';

const {ConflictError} = require(`../../index`);

module.exports = function checkCreateConflict(api, config) {

	return function checkCreateConflictMiddleware(args, resolve, reject) {
		// If the resource (data) already exists, then we have a ConflictError.
		if (args.response && args.response.data) {
			const {type, id} = args.res.data;
			const err = new ConflictError(
				`Resource "${type}:${id}" already exists and cannot be created`
			);
			return reject(err);
		}
		return resolve(args);
	};
};
