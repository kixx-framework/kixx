'use strict';

const Promise = require(`bluebird`);
const StackedError = require(`./classes/stacked-error`);
const ProgrammerError = require(`./classes/programmer-error`);
const UnprocessableError = require(`./classes/unprocessable-error`);
const StoreArgs = require(`./classes/store-args`);

const {complement, isFunction, isNonEmptyString, isObject, omit} = require(`../library`);

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
	`beforeMerge`,
	`beforeRemove`,
	`beforeScan`,
	`beforeSet`,
	`beforeUpdate`,
	`checkCreateConflict`,
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

const isNotFunction = complement(isFunction);

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
// checking the default configuration for the MIDDLEWARE.
//
// Then create the middleware stack for each operation (create, get, update,
// remove, scan) using createModel().
//
// When each public function is called (create, get, update, remove, scan) use
// composeMiddleware() to compose and invoke the configured middleware stack
// for a particular Model type and return a Promise instance.
//
// `defaultModel` is a hash Object of middlware functions which serve as a
// backstop when the middleware is not available on the model.
//
// `models` is an Array of hash Objects of model specifications.
//
// Each middleware will be invoked with (api, model, args, resolve, reject).

module.exports = defineFunction({
	name: `createApplicationStore`,
	params: [],
	func: function createApplicationStore(defaultModel, storeName, models, api) {
		MIDDLEWARE.forEach((middlewareName) => {
			const defaultHandler = defaultModel[middlewareName];
			if (isNotFunction(defaultHandler)) {
				throw new ProgrammerError(
					`Invalid or missing default middleware Function for '${middlewareName}'.`
				);
			}
		});

		if (!isNonEmptyString(storeName)) {
			throw new ProgrammerError(`A valid storeName String is required`);
		}

		if (!Array.isArray(models)) {
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

		const configuredModels = models.reduce((configuredModels, model, i) => {
			const {type} = model;

			if (!isNonEmptyString(type)) {
				throw new ProgrammerError(
					`Invalid .type String in model configuration at index [${i}]`
				);
			}

			const middleware = MIDDLEWARE.reduce((middleware, middlewareName) => {
				const handler = model[middlewareName];

				if (handler && isNotFunction(handler)) {
					throw new ProgrammerError(
						`Invalid store middleware Function for '${middlewareName}' in type '${type}'`
					);
				}

				if (handler) {
					middleware[middlewareName] = createMiddleware(api, handler, model);
				} else {
					middleware[middlewareName] = createMiddleware(api, defaultModel[middlewareName], model);
				}

				return middleware;
			}, Object.create(null));

			configuredModels[type] = createModel(model, middleware);
			return configuredModels;
		}, Object.create(null));

		function checkRelationships(isGlobal, rel) {
			if (!rel) return false;

			const keys = Object.keys(rel);
			if (keys.length === 0) return false;

			isGlobal = Boolean(isGlobal);

			for (let i = keys.length - 1; i >= 0; i--) {
				const relationship = keys[i];
				const items = rel[relationship];

				for (let n = items.length - 1; n >= 0; n--) {
					const {type} = items[n];
					if (!isNonEmptyString(type)) {
						return {
							message: `Missing relationship key type in relationship '${relationship}'`,
							pointer: `/data/relationships/${relationship}`
						};
					}
					const Model = configuredModels[type];
					if (!Model) {
						return {
							message: `No type exists '${type}'`,
							pointer: `/data/relationships/${relationship}`
						};
					}

					if (Boolean(Model.global) !== isGlobal) {
						if (Model.global) {
							return {
								message: `A non global resource cannot be related to a global resource`,
								pointer: `/data/relationships/${relationship}`
							};
						}
						return {
							message: `A global resource cannot be related to a non global resource`,
							pointer: `/data/relationships/${relationship}`
						};
					}
				}
			}
		}

		return Object.freeze({
			create(transaction, args) {
				const {object} = args;
				const {type, id, attributes, relationships, meta} = object;
				const Model = configuredModels[type];

				if (!isObject(transaction)) {
					throw new ProgrammerError(
						`Invalid args.transaction passed to '${storeName}' create()`
					);
				}
				if (!isNonEmptyString(type)) {
					throw new ProgrammerError(
						`Invalid args.object.type passed to '${storeName}' create()`
					);
				}
				if (!Model) {
					throw new ProgrammerError(
						`No model for type '${type}' in '${storeName}' create()`
					);
				}
				if (!Model.global && !isNonEmptyString(args.scope)) {
					throw new ProgrammerError(
						`Invalid args.scope for non-global type '${type}' in '${storeName}' create()`
					);
				}
				const relerr = checkRelationships(Model.global, relationships);
				if (relerr) {
					throw new UnprocessableError(
						`${relerr.message} for type '${type}' in create()`,
						{pointer: relerr.pointer}
					);
				}

				const scope = Model.global ? GLOBAL_SCOPE : args.scope;

				const middleware = Model.create;

				// Compose the arguments that will be expected by the
				// middleware stack.
				const spec = StoreArgs.create({
					operation: `create`,
					transaction,
					scope,
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
								`Error in store '${storeName}' create()`,
								err
							));
						}
						return resolve(res);
					})(spec);
				});
			},
			get(transaction, args) {
				const {type, id, include} = args;
				const Model = configuredModels[type];

				if (!isObject(transaction)) {
					throw new ProgrammerError(
						`Invalid args.transaction passed to '${storeName}' get()`
					);
				}
				if (!isNonEmptyString(type)) {
					throw new ProgrammerError(
						`Invalid args.type passed to '${storeName}' get()`
					);
				}
				if (!isNonEmptyString(id)) {
					throw new ProgrammerError(
						`Invalid args.id passed to '${storeName}' get()`
					);
				}
				if (!Model) {
					throw new ProgrammerError(
						`No model for type '${type}' in '${storeName}' get()`
					);
				}
				if (!Model.global && !isNonEmptyString(args.scope)) {
					throw new ProgrammerError(
						`Invalid args.scope for non-global type '${type}' in '${storeName}' get()`
					);
				}

				const scope = Model.global ? GLOBAL_SCOPE : args.scope;

				const middleware = Model.get;

				// Compose the arguments that will be expected by the
				// middleware stack.
				const spec = StoreArgs.create({
					operation: `get`,
					transaction,
					scope,
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
								`Error in store '${storeName}' get()`,
								err
							));
						}
						return resolve(res);
					})(spec);
				});
			},
			update(transaction, args) {
				const {object} = args;
				const {type, id, attributes, relationships, meta} = object;
				const Model = configuredModels[type];

				if (!isObject(transaction)) {
					throw new ProgrammerError(
						`Invalid args.transaction passed to '${storeName}' update()`
					);
				}
				if (!isNonEmptyString(type)) {
					throw new ProgrammerError(
						`Invalid args.object.type passed to '${storeName}' update()`
					);
				}
				if (!Model) {
					throw new ProgrammerError(
						`No model for type '${type}' in '${storeName}' update()`
					);
				}
				if (!Model.global && !isNonEmptyString(args.scope)) {
					throw new ProgrammerError(
						`Invalid args.scope for non-global type '${type}' in '${storeName}' update()`
					);
				}
				const relerr = checkRelationships(Model.global, relationships);
				if (relerr) {
					throw new UnprocessableError(
						`${relerr.message} for type '${type}' in update()`,
						{pointer: relerr.pointer}
					);
				}

				const scope = Model.global ? GLOBAL_SCOPE : args.scope;

				const middleware = Model.update;

				// Compose the arguments that will be expected by the
				// middleware stack.
				const spec = StoreArgs.create({
					operation: `update`,
					transaction,
					scope,
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
								`Error in store '${storeName}' update()`,
								err
							));
						}
						return resolve(res);
					})(spec);
				});
			},
			remove(transaction, args) {
				const {type, id} = args;
				const Model = configuredModels[type];

				if (!isObject(transaction)) {
					throw new ProgrammerError(
						`Invalid args.transaction passed to '${storeName}' remove()`
					);
				}
				if (!isNonEmptyString(type)) {
					throw new ProgrammerError(
						`Invalid args.type passed to '${storeName}' remove()`
					);
				}
				if (!isNonEmptyString(id)) {
					throw new ProgrammerError(
						`Invalid args.id passed to '${storeName}' remove()`
					);
				}
				if (!Model) {
					throw new ProgrammerError(
						`No model for type '${type}' in '${storeName}' remove()`
					);
				}
				if (!Model.global && !isNonEmptyString(args.scope)) {
					throw new ProgrammerError(
						`Invalid args.scope for non-global type '${type}' in '${storeName}' remove()`
					);
				}

				const scope = Model.global ? GLOBAL_SCOPE : args.scope;

				const middleware = Model.remove;

				// Compose the arguments that will be expected by the
				// middleware stack.
				const spec = StoreArgs.create({
					operation: `remove`,
					transaction,
					scope,
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
								`Error in store '${storeName}' remove()`,
								err
							));
						}
						return resolve(res);
					})(spec);
				});
			},
			scan(transaction, args) {
				const {type, cursor} = args;
				const limit = args.limit && Number.isInteger(args.limit) ? args.limit : 10;
				const Model = configuredModels[type];

				if (!isObject(transaction)) {
					throw new ProgrammerError(
						`Invalid args.transaction passed to '${storeName}' scan()`
					);
				}
				if (!isNonEmptyString(type)) {
					throw new ProgrammerError(
						`Invalid args.type passed to '${storeName}' scan()`
					);
				}
				if (!Model) {
					throw new ProgrammerError(
						`No model for type '${type}' in '${storeName}' scan()`
					);
				}
				if (!Model.global && !isNonEmptyString(args.scope)) {
					throw new ProgrammerError(
						`Invalid args.scope for non-global type '${type}' in '${storeName}' scan()`
					);
				}

				const scope = Model.global ? GLOBAL_SCOPE : args.scope;

				const middleware = Model.scan;

				// Compose the arguments that will be expected by the
				// middleware stack.
				const spec = StoreArgs.create({
					operation: `scan`,
					transaction,
					scope,
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
								`Error in store '${storeName}' scan()`,
								err
							));
						}
						return resolve(res);
					})(spec);
				});
			}
		});
	}
});

function createModel(spec, middleware) {
	return Object.freeze({
		type: spec.type,
		global: Boolean(spec.global),
		create: Object.freeze([
			middleware.validateBeforeCreate,
			middleware.beforeCreate,
			middleware.getObject,
			middleware.generateId,
			middleware.checkCreateConflict,
			middleware.beforeSet,
			middleware.setObject,
			middleware.afterCreate,
			middleware.emit
		]),
		get: Object.freeze([
			middleware.validateBeforeGet,
			middleware.beforeGet,
			middleware.getObject,
			middleware.afterGet,
			middleware.emit
		]),
		update: Object.freeze([
			middleware.validateBeforeUpdate,
			middleware.beforeUpdate,
			middleware.getObject,
			middleware.validateObjectExists,
			middleware.beforeMerge,
			middleware.mergeObject,
			middleware.beforeSet,
			middleware.setObject,
			middleware.afterUpdate,
			middleware.emit
		]),
		remove: Object.freeze([
			middleware.validateBeforeRemove,
			middleware.beforeRemove,
			middleware.removeObject,
			middleware.afterRemove,
			middleware.emit
		]),
		scan: Object.freeze([
			middleware.validateBeforeScan,
			middleware.beforeScan,
			middleware.scanObjectsByType,
			middleware.afterScan,
			middleware.emit
		])
	});
}

function createMiddleware(api, fn, model) {
	model = model || {};

	return function (args, resolve, reject) {
		return fn(api, model, args, resolve, reject);
	};
}
