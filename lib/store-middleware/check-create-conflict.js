'use strict';

module.exports = function checkCreateConflict(api, config) {
	return function checkCreateConflictMiddleware(args, resolve, reject) {
		if (args.res && args.res.data) {
			const {type, id} = args.res.data;
			const err = new Error(
				`Resource "${type}:${id}" already exists and cannot be created`
			);
			err.code = `CREATE_RESOURCE_CONFLICT_ERROR`;
			return reject(err);
		}
		return resolve(args);
	};
};
