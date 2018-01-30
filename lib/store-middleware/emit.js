'use strict';

const ProgrammerError = require(`../classes/programmer-error`);
const {isObject, isFunction} = require(`../../library`);

module.exports = function emit() {
	return function (api, model, args, resolve, reject) {
		if (!isObject(api)) {
			throw new ProgrammerError(
				`Invalid API Object passed into Kixx store middleware emit().`
			);
		}
		if (!isObject(api.eventBus) || !isFunction(api.eventBus.broadcast)) {
			throw new ProgrammerError(
				`Invalid api.eventBus Object passed into Kixx store middleware emit().`
			);
		}

		const eventBus = api.eventBus;

		const {operation, scope, type} = args;

		eventBus.broadcast({
			type: `STORE_ACCESS`,
			pattern: `${operation}:${type}:${scope}`,
			payload: args
		});

		return resolve(args);
	};
};
