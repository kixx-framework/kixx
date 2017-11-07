'use strict';

const Promise = require(`bluebird`);
const {StackedError, ProgrammerError} = require(`../../index`);
const {isFunction, isNumber, isNonEmptyString} = require(`../../library`);
const defineFunction = require(`./define-function`);
const composeMiddleware = require(`./compose-middleware`);

const MIDDLEWARE = [
	`afterCreate`,
	`afterGet`,
	`afterRemove`,
	`afterScan`,
	`afterUpdate`,
	`beforeCreate`,
	`beforeGet`,
	`beforeRemove`,
	`beforeScan`,
	`beforeUpdate`,
	`checkCreateConflict`,
	`emit`,
	`getObject`,
	`mergeObject`,
	`removeObject`,
	`setObject`,
	`scanObjectsByType`,
	`validateBeforeCreate`,
	`validateBeforeGet`,
	`validateBeforeRemove`,
	`validateBeforeScan`,
	`validateBeforeUpdate`
];

// Iterate through each MIDDLEWARE name and look for a function by the same
// name. Look first on the model configuration for the middleware before
// checking the default global configuration for the MIDDLEWARE.
//
// Then create the middleware stack for each operation (create, get, update,
// remove, scan) using createModel().
//
// When each public function is called (create, get, update, remove, scan) use
// composeMiddleware() to compose and invoke the configured middleware stack
// for a particular Model type and return a Promise instance.

module.exports = defineFunction({
	name: `createApplicationStore`,
	params: [],
	func: function createApplicationStore(globalConfig, storeName, modelConfigs, api) {
		globalConfig = globalConfig || {};
		modelConfigs = modelConfigs || {};

		MIDDLEWARE.forEach((name) => {
			if (!isFunction(globalConfig[name])) {
				throw new ProgrammerError(
					`Invalid or missing global middleware factory for "${name}" in globalConfig.`
				);
			}
		});

		if (!isNonEmptyString(storeName)) {
			throw new ProgrammerError(`A valid storeName String is required`);
		}

		if (!Array.isArray()) {
			throw new ProgrammerError(`A modelConfigs Array is required`);
		}

		const models = modelConfigs.reduce((models, config, i) => {
			const {type} = config;

			if (!isNonEmptyString(type)) {
				throw new ProgrammerError(
					`Invalid .type String in model configuration at index [${i}]`
				);
			}

			const middleware = MIDDLEWARE.reduce((middleware, name) => {
				if (config[name] && !isFunction(config[name])) {
					throw new ProgrammerError(
						`Invalid middleware (non-Function value) configured for "${name}" in type "${type}"`
					);
				}
				middleware[name] = createMiddleware(config[name] || globalConfig[name], api);
				return middleware;
			}, Object.create(null));

			models[type] = createModel(middleware);
			return models;
		}, Object.create(null));

		return Object.defineProperties(Object.create(null), {
			create: {
				enumerable: true,
				value: function create(scope, transaction, object, options) {
					const {type, id, attributes, relationships} = object;
					const Model = models[type];

					const middleware = Model.create;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const args = {
						operation: `create`,
						transaction,
						scope,
						type,
						id,
						attributes,
						relationships,
						options
					};

					return new Promise((resolve, reject) => {
						composeMiddleware(middleware, (err, res) => {
							if (err) {
								return reject(new StackedError(
									`Error in store "${storeName}" create()`,
									err,
									create
								));
							}
							return resolve(res);
						})(args);
					});
				}
			},
			get: {
				enumerable: true,
				value: function get(scope, transaction, key, options) {
					const {type, id} = key;
					const Model = models[type];

					const middleware = Model.get;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const args = {
						operation: `get`,
						transaction,
						scope,
						type,
						id,
						include: options.include,
						options
					};

					return new Promise((resolve, reject) => {
						composeMiddleware(middleware, (err, res) => {
							if (err) {
								return reject(new StackedError(
									`Error in store "${storeName}" get()`,
									err,
									get
								));
							}
							return resolve(res);
						})(args);
					});
				}
			},
			update: {
				enumerable: true,
				value: function update(scope, transaction, object, options) {
					const {type, id, attributes, relationships} = object;
					const Model = models[type];

					const middleware = Model.update;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const args = {
						operation: `update`,
						transaction,
						scope,
						type,
						id,
						attributes,
						relationships,
						options
					};

					return new Promise((resolve, reject) => {
						composeMiddleware(middleware, (err, res) => {
							if (err) {
								return reject(new StackedError(
									`Error in store "${storeName}" update()`,
									err,
									update
								));
							}
							return resolve(res);
						})(args);
					});
				}
			},
			remove: {
				enumerable: true,
				value: function remove(scope, transaction, key, options) {
					const {type, id} = key;
					const Model = models[type];

					const middleware = Model.remove;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const args = {
						operation: `remove`,
						transaction,
						scope,
						type,
						id,
						options
					};

					return new Promise((resolve, reject) => {
						composeMiddleware(middleware, (err, res) => {
							if (err) {
								return reject(new StackedError(
									`Error in store "${storeName}" remove()`,
									err,
									remove
								));
							}
							return resolve(res);
						})(args);
					});
				}
			},
			scan: {
				enumerable: true,
				value: function scan(scope, transaction, params, options) {
					const {type, cursor} = params;
					const Model = models[type];
					const limit = params.limit && isNumber(params.limit) ? params.limit : 10;

					const middleware = Model.scan;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const args = {
						operation: `scan`,
						transaction,
						scope,
						type,
						cursor,
						limit,
						options
					};

					return new Promise((resolve, reject) => {
						composeMiddleware(middleware, (err, res) => {
							if (err) {
								return reject(new StackedError(
									`Error in store "${storeName}" scan()`,
									err,
									scan
								));
							}
							return resolve(res);
						})(args);
					});
				}
			}
		});
	}
});

function createModel(middleware) {
	return {
		create: [
			middleware.validateBeforeCreate,
			middleware.beforeCreate,
			middleware.getObject,
			middleware.checkCreateConflict,
			middleware.setObject,
			middleware.afterCreate,
			middleware.emit
		],
		get: [
			middleware.validateBeforeGet,
			middleware.beforeGet,
			middleware.getObject,
			middleware.afterGet,
			middleware.emit
		],
		update: [
			middleware.validateBeforeUpdate,
			middleware.beforeUpdate,
			middleware.getObject,
			middleware.mergeObject,
			middleware.setObject,
			middleware.afterUpdate,
			middleware.emit
		],
		remove: [
			middleware.validateBeforeRemove,
			middleware.beforeRemove,
			middleware.removeObject,
			middleware.afterRemove,
			middleware.emit
		],
		scan: [
			middleware.validateBeforeScan,
			middleware.beforeScan,
			middleware.scanObjectsByType,
			middleware.afterScan,
			middleware.emit
		]
	};
}

function createMiddleware(seed, api) {
	const [factory, config] = seed;
	return factory(api, config);
}
