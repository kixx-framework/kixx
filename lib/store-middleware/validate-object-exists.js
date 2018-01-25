'use strict';

const NotFoundError = require(`../classes/not-found-error`);

module.exports = function () {
	return function validateObjectExists(api, model, args, resolve, reject) {
		if (args.response && args.response.data) {
			return resolve(args);
		}

		const {type, id} = args.parameters;
		return reject(new NotFoundError(
			`Resource type: "${type}" id: "${id}" cannot be found`
		));
	};
};
