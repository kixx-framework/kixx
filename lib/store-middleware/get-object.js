'use strict';

const {StackedError} = require(`../classes/stacked-error`);
const {ProgrammerError} = require(`../classes/programmer-error`);
const {isNonEmptyString} = require(`../../library`);

module.exports = function getObject() {
	return function (api, model, args, resolve, reject) {
		const {transaction, scope, parameters, options} = args;
		const {type, id, include} = parameters;

		if (!isNonEmptyString(id)) {
			return reject(new ProgrammerError(
				`The parameters.id String must be present in getObject() store middleware.`
			));
		}

		const key = {type, id};

		return transaction.get({scope, key, include, options}).then((res) => {
			// res.data Object or null
			// res.included Array
			// res.meta Object
			return resolve(args.setResponse(res));
		}, (err) => {
			return reject(
				new StackedError(`Error in getObject() store middleware`, err)
			);
		});
	};
};
