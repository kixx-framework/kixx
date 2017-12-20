'use strict';

const Promise = require(`bluebird`);
const StackedError = require(`./classes/stacked-error`);
const ProgrammerError = require(`./classes/programmer-error`);
const StoreArgs = require(`./classes/store-args`);

const {isObject, isFunction, isNonEmptyString, omit} = require(`../library`);

const defineFunction = require(`./define-function`);
const composeMiddleware = require(`./compose-middleware`);

const GLOBAL_SCOPE = `GLOBAL_SCOPE`;

const MIDDLEWARE = Object.freeze([
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
	`commitTransaction`,
	`emit`,
	`generateId`,
	`getObject`,
	`mergeObject`,
	`removeObject`,
	`scanObjectsByType`,
	`setObject`,
	`validateBeforeCreate`,
	`validateBeforeGet`,
	`validateBeforeRemove`,
	`validateBeforeScan`,
	`validateBeforeUpdate`,
	`validateObjectExists`
]);

const omitParams = omit([
	`type`,
	`id`,
	`scope`,
	`object`,
	`cursor`,
	`limit`,
	`include`
]);

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
//
// `globalConfigs` is a hash Object of middlware config Tuples. Each Tuple
// consists of [Function, Object], where Function is the factory
// for the middleware and Object is the static configuration hash.
//
// `modelConfigs` is an Array of hash Objects of middleware config Tuples.
//
// Each factory Function will be called with `factory(api, config)`, where
// `api` is the `api` argument passed into `createApplicationStore()` and config
// is the static configuration hash.

module.exports = defineFunction({
	name: `createApplicationStore`,
	params: [],
	func: function createApplicationStore(globalConfigs, storeName, modelConfigs, api) {
		globalConfigs = globalConfigs || {};
		modelConfigs = modelConfigs || {};

		MIDDLEWARE.forEach((name) => {
			const seed = globalConfigs[name];
			if (!Array.isArray(seed)) {
				throw new ProgrammerError(
					`Invalid or missing global middleware Array for "${name}" in globalConfigs.`
				);
			}
			if (!isFunction(seed[0])) {
				throw new ProgrammerError(
					`Invalid or missing global middleware factory Function for "${name}" in globalConfigs.`
				);
			}
		});
		if (!isNonEmptyString(storeName)) {
			throw new ProgrammerError(`A valid storeName String is required`);
		}
		if (!Array.isArray(modelConfigs)) {
			throw new ProgrammerError(`A modelConfigs Array is required`);
		}
		if (!isObject(api)) {
			throw new ProgrammerError(
				`Invalid API Object passed into createApplicationStore().`
			);
		}
		if (!isObject(api.eventBus)) {
			throw new ProgrammerError(
				`Invalid api.eventBus Object passed into Kixx store middleware emit().`
			);
		}

		const models = modelConfigs.reduce((models, config, i) => {
			const {type} = config;

			if (!isNonEmptyString(type)) {
				throw new ProgrammerError(
					`Invalid .type String in model configuration at index [${i}]`
				);
			}

			const middleware = MIDDLEWARE.reduce((middleware, name) => {
				const modelSeed = config[name];
				if (modelSeed && !Array.isArray(modelSeed)) {
					throw new ProgrammerError(
						`Invalid middleware configuration (non-array) for "${name}" in type "${type}"`
					);
				}
				const globalSeed = globalConfigs[name];
				middleware[name] = createMiddleware(modelSeed || globalSeed, api);
				return middleware;
			}, Object.create(null));

			models[type] = createModel(config, middleware);
			return models;
		}, Object.create(null));

		return Object.defineProperties(Object.create(null), {
			create: {
				enumerable: true,
				value: function create(transaction, args) {
					const {object, scope} = args;
					const {type, id, attributes, relationships, meta} = object;
					const Model = models[type];

					if (!isObject(transaction)) {
						throw new ProgrammerError(
							`Invalid args.transaction passed to "${storeName}" create()`
						);
					}
					if (!isNonEmptyString(type)) {
						throw new ProgrammerError(
							`Invalid args.object.type passed to "${storeName}" create()`
						);
					}
					if (!Model) {
						throw new ProgrammerError(
							`No model for type "${type}" in "${storeName}" create()`
						);
					}
					if (!Model.global && !isNonEmptyString(scope)) {
						throw new ProgrammerError(
							`Invalid args.scope for non-global type "${type}" in "${storeName}" create()`
						);
					}

					const middleware = Model.create;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const spec = StoreArgs.create({
						operation: `create`,
						transaction,
						scope: scope || GLOBAL_SCOPE,
						payload: {
							type,
							id,
							attributes,
							relationships,
							meta
						},
						parameters: {
							type,
							id
						},
						options: omitParams(args)
					});

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
						})(spec);
					});
				}
			},
			get: {
				enumerable: true,
				value: function get(transaction, args) {
					const {type, id, scope, include} = args;
					const Model = models[type];

					if (!isObject(transaction)) {
						throw new ProgrammerError(
							`Invalid args.transaction passed to "${storeName}" get()`
						);
					}
					if (!isNonEmptyString(type)) {
						throw new ProgrammerError(
							`Invalid args.type passed to "${storeName}" get()`
						);
					}
					if (!isNonEmptyString(id)) {
						throw new ProgrammerError(
							`Invalid args.id passed to "${storeName}" get()`
						);
					}
					if (!Model) {
						throw new ProgrammerError(
							`No model for type "${type}" in "${storeName}" get()`
						);
					}
					if (!Model.global && !isNonEmptyString(scope)) {
						throw new ProgrammerError(
							`Invalid args.scope for non-global type "${type}" in "${storeName}" get()`
						);
					}

					const middleware = Model.get;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const spec = StoreArgs.create({
						operation: `get`,
						transaction,
						scope: scope || GLOBAL_SCOPE,
						parameters: {
							type,
							id,
							include
						},
						options: omitParams(args)
					});

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
						})(spec);
					});
				}
			},
			update: {
				enumerable: true,
				value: function update(transaction, args) {
					const {scope, object} = args;
					const {type, id, attributes, relationships, meta} = object;
					const Model = models[type];

					if (!isObject(transaction)) {
						throw new ProgrammerError(
							`Invalid args.transaction passed to "${storeName}" update()`
						);
					}
					if (!isNonEmptyString(type)) {
						throw new ProgrammerError(
							`Invalid args.object.type passed to "${storeName}" update()`
						);
					}
					if (!Model) {
						throw new ProgrammerError(
							`No model for type "${type}" in "${storeName}" update()`
						);
					}
					if (!Model.global && !isNonEmptyString(scope)) {
						throw new ProgrammerError(
							`Invalid args.scope for non-global type "${type}" in "${storeName}" update()`
						);
					}

					const middleware = Model.update;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const spec = StoreArgs.create({
						operation: `update`,
						transaction,
						scope: scope || GLOBAL_SCOPE,
						payload: {
							type,
							id,
							attributes,
							relationships,
							meta
						},
						parameters: {
							type,
							id
						},
						options: omitParams(args)
					});

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
						})(spec);
					});
				}
			},
			remove: {
				enumerable: true,
				value: function remove(transaction, args) {
					const {type, id, scope} = args;
					const Model = models[type];

					if (!isObject(transaction)) {
						throw new ProgrammerError(
							`Invalid args.transaction passed to "${storeName}" remove()`
						);
					}
					if (!isNonEmptyString(type)) {
						throw new ProgrammerError(
							`Invalid args.type passed to "${storeName}" remove()`
						);
					}
					if (!isNonEmptyString(id)) {
						throw new ProgrammerError(
							`Invalid args.id passed to "${storeName}" remove()`
						);
					}
					if (!Model) {
						throw new ProgrammerError(
							`No model for type "${type}" in "${storeName}" remove()`
						);
					}
					if (!Model.global && !isNonEmptyString(scope)) {
						throw new ProgrammerError(
							`Invalid args.scope for non-global type "${type}" in "${storeName}" remove()`
						);
					}

					const middleware = Model.remove;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const spec = StoreArgs.create({
						operation: `remove`,
						transaction,
						scope: scope || GLOBAL_SCOPE,
						parameters: {
							type,
							id
						},
						options: omitParams(args)
					});

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
						})(spec);
					});
				}
			},
			scan: {
				enumerable: true,
				value: function scan(transaction, args) {
					const {scope, type, cursor} = args;
					const limit = args.limit && Number.isInteger(args.limit) ? args.limit : 10;
					const Model = models[type];

					if (!isObject(transaction)) {
						throw new ProgrammerError(
							`Invalid args.transaction passed to "${storeName}" scan()`
						);
					}
					if (!isNonEmptyString(type)) {
						throw new ProgrammerError(
							`Invalid args.type passed to "${storeName}" scan()`
						);
					}
					if (!Model) {
						throw new ProgrammerError(
							`No model for type "${type}" in "${storeName}" scan()`
						);
					}
					if (!Model.global && !isNonEmptyString(scope)) {
						throw new ProgrammerError(
							`Invalid args.scope for non-global type "${type}" in "${storeName}" scan()`
						);
					}

					const middleware = Model.scan;

					// Compose the arguments that will be expected by the
					// middleware stack.
					const spec = StoreArgs.create({
						operation: `scan`,
						transaction,
						scope: scope || GLOBAL_SCOPE,
						parameters: {
							type,
							cursor,
							limit
						},
						options: omitParams(args)
					});

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
						})(spec);
					});
				}
			}
		});
	}
});

function createModel(config, middleware) {
	return Object.freeze({
		type: config.type,
		global: Boolean(config.global),
		create: Object.freeze([
			middleware.validateBeforeCreate,
			middleware.beforeCreate,
			middleware.generateId,
			middleware.getObject,
			middleware.checkCreateConflict,
			middleware.setObject,
			middleware.afterCreate,
			middleware.commitTransaction,
			middleware.emit
		]),
		get: Object.freeze([
			middleware.validateBeforeGet,
			middleware.beforeGet,
			middleware.getObject,
			middleware.afterGet,
			middleware.commitTransaction,
			middleware.emit
		]),
		update: Object.freeze([
			middleware.validateBeforeUpdate,
			middleware.beforeUpdate,
			middleware.getObject,
			middleware.validateObjectExists,
			middleware.mergeObject,
			middleware.setObject,
			middleware.afterUpdate,
			middleware.commitTransaction,
			middleware.emit
		]),
		remove: Object.freeze([
			middleware.validateBeforeRemove,
			middleware.beforeRemove,
			middleware.removeObject,
			middleware.afterRemove,
			middleware.commitTransaction,
			middleware.emit
		]),
		scan: Object.freeze([
			middleware.validateBeforeScan,
			middleware.beforeScan,
			middleware.scanObjectsByType,
			middleware.afterScan,
			middleware.commitTransaction,
			middleware.emit
		])
	});
}

function createMiddleware(seed, api) {
	const [factory, config] = seed;
	return factory(api, config || Object.create(null));
}
