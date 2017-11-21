'use strict';

const NotFoundError = require(`../classes/not-found-error`);

module.exports = function validateObjectExists() {
	return function validateObjectExistsMiddleware(args, resolve, reject) {
		if (!args.response || !args.response.data) {
			const {type, id} = args.parameters;
			return reject(new NotFoundError(
				`Resource "${type}:${id}" cannot be found`
			));
		}
		return resolve(args);
	};
};
