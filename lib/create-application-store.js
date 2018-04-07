'use strict';

const Promise = require('bluebird');
const {composeMiddleware, uuidV1} = require('kixx');
const {assert, assoc, isNonEmptyString} = require('kixx/library');

const GLOBAL_SCOPE = 'GLOBAL_SCOPE';

const assignScope = assoc('scope');
const assignId = assoc('id');

const DEFUAULT_METHODS = {
	// no-op
	// validateBeforeCreate(api, transaction, scope, object, options) {},

	generateId(api, transaction, scope, object, options) {
		if (isNonEmptyString(object.id)) return object.id;
		return uuidV1();
	},

	create(api, transaction, scope, object, options) {
		object = assignScope(scope, object);
		return transaction.createItem(object, options).then((res) => {
			return res.item;
		});
	},

	// no-op
	// afterCreate(api, transaction, scope, object, options) {},

	// no-op
	// validateBeforeUpdate(api, transaction, scope, object, options) {},

	updateOrCreate(api, transaction, scope, object, options) {
		object = assignScope(scope, object);
		return transaction.updateOrCreateItem(object, options).then((res) => {
			return res.item;
		});
	},

	// no-op
	// afterUpdate(api, transaction, scope, object, options) {},

	// no-op
	// validateBeforeGet(api, transaction, scope, object, options) {},

	get(api, transaction, scope, object, options) {
		object = assignScope(scope, object);
		return transaction.getItem(object, options).then((res) => {
			return res.item;
		});
	}

	// no-op
	// afterGet(api, transaction, scope, object, options) {}
};

// specs is an Array of type specifications like:
//
// {
// 	type: 'widget',
// 	isGlobal: true,
// 	afterCreate: function() {}
// }
//
function createApplicationStore(specs, options = {}) {
	const defaultSpec = options.defaultSpec || createSpecification(createApplicationStore.defaults);

	const specifications = specs.reduce((specifications, spec) => {
		assert.isNonEmptyString(spec.type, 'missing spec.type');
		const {type} = spec;

		specifications[type] = createSpecification(spec);
		return specifications;
	}, Object.create(null));

	return {
		create(api, transaction, scope, object, options = {}) {
			assert.isNonEmptyString(object.type, 'object.type');

			const {type} = object;

			const spec = specifications[type] || defaultSpec;

			if (spec.isGlobal) {
				scope = GLOBAL_SCOPE;
			} else {
				assert.isNonEmptyString(scope, `scope for non-global type ${type}`);
			}

			return spec.create(api, transaction, scope, object, options);
		},

		updateOrCreate(api, transaction, scope, object, options = {}) {
			assert.isNonEmptyString(object.type, 'object.type');
			assert.isNonEmptyString(object.id, 'object.id');

			const {type} = object;

			const spec = specifications[type] || defaultSpec;

			if (spec.isGlobal) {
				scope = GLOBAL_SCOPE;
			} else {
				assert.isNonEmptyString(scope, `scope for non-global type ${type}`);
			}

			return spec.updateOrCreate(api, transaction, scope, object, options);
		},

		get(api, transaction, scope, object, options = {}) {
			assert.isNonEmptyString(object.type, 'object.type');
			assert.isNonEmptyString(object.id, 'object.id');

			const {type} = object;

			const spec = specifications[type] || defaultSpec;

			if (spec.isGlobal) {
				scope = GLOBAL_SCOPE;
			} else {
				assert.isNonEmptyString(scope, `scope for non-global type ${type}`);
			}

			return spec.get(api, transaction, scope, object, options);
		}
	};
}

module.exports = createApplicationStore;

createApplicationStore.defaults = DEFUAULT_METHODS;

createApplicationStore.validateBeforeCreate = function (fn) {
	return function validateBeforeCreate(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		const errs = fn(api, transaction, scope, object, options);
		if (Array.isArray(errs) && errs.length > 0) return reject(errs);
		return resolve(args);
	};
};

createApplicationStore.generateId = function (fn) {
	return function generateId(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;
		const id = fn(api, transaction, scope, object, options);
		return {
			api,
			transaction,
			scope,
			object: assignId(id, object),
			options
		};
	};
};

createApplicationStore.create = function (fn) {
	return function create(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		return fn(api, transaction, scope, object, options).then((object) => {
			resolve({api, transaction, scope, object, options});
			return null;
		}, reject);
	};
};

createApplicationStore.afterCreate = function (fn) {
	return function afterCreate(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		const res = fn(api, transaction, scope, object, options);

		if (res.then) {
			return res.then((object) => {
				resolve({api, transaction, scope, object, options});
				return null;
			}, reject);
		}

		return res;
	};
};

createApplicationStore.validateBeforeUpdate = function (fn) {
	return function validateBeforeUpdate(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		const errs = fn(api, transaction, scope, object, options);
		if (Array.isArray(errs) && errs.length > 0) return reject(errs);
		return resolve(args);
	};
};

createApplicationStore.updateOrCreate = function (fn) {
	return function updateOrCreate(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		return fn(api, transaction, scope, object, options).then((object) => {
			resolve({api, transaction, scope, object, options});
			return null;
		}, reject);
	};
};

createApplicationStore.afterUpdate = function (fn) {
	return function afterUpdate(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		const res = fn(api, transaction, scope, object, options);

		if (res.then) {
			return res.then((object) => {
				resolve({api, transaction, scope, object, options});
				return null;
			}, reject);
		}

		return res;
	};
};

createApplicationStore.validateBeforeGet = function (fn) {
	return function validateBeforeGet(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		const errs = fn(api, transaction, scope, object, options);
		if (Array.isArray(errs) && errs.length > 0) return reject(errs);
		return resolve(args);
	};
};

createApplicationStore.get = function (fn) {
	return function get(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		return fn(api, transaction, scope, object, options).then((object) => {
			resolve({api, transaction, scope, object, options});
			return null;
		}, reject);
	};
};

createApplicationStore.afterGet = function (fn) {
	return function afterGet(args, resolve, reject) {
		const {api, transaction, scope, object, options} = args;

		const res = fn(api, transaction, scope, object, options);

		if (res.then) {
			return res.then((object) => {
				resolve({api, transaction, scope, object, options});
				return null;
			}, reject);
		}

		return res;
	};
};

function createSpecification(spec) {
	const createMiddleware = [];
	const updateOrCreateMiddleware = [];
	const getMiddleware = [];

	spec = Object.assign(
		Object.create(null),
		createApplicationStore.defaults,
		spec
	);

	if (typeof spec.validateBeforeCreate === 'function') {
		createMiddleware.push(
			createApplicationStore.validateBeforeCreate(spec.validateBeforeCreate)
		);
	}
	createMiddleware.push(
		createApplicationStore.generateId(spec.generateId)
	);
	createMiddleware.push(
		createApplicationStore.create(spec.create)
	);
	if (typeof spec.afterCreate === 'function') {
		createMiddleware.push(
			createApplicationStore.afterCreate(spec.afterCreate)
		);
	}

	if (typeof spec.validateBeforeUpdate === 'function') {
		createMiddleware.push(
			createApplicationStore.validateBeforeUpdate(spec.validateBeforeUpdate)
		);
	}
	createMiddleware.push(
		createApplicationStore.updateOrCreate(spec.updateOrCreate)
	);
	if (typeof spec.afterUpdate === 'function') {
		createMiddleware.push(
			createApplicationStore.afterUpdate(spec.afterUpdate)
		);
	}

	if (typeof spec.validateBeforeGet === 'function') {
		createMiddleware.push(
			createApplicationStore.validateBeforeGet(spec.validateBeforeGet)
		);
	}
	createMiddleware.push(
		createApplicationStore.get(spec.get)
	);
	if (typeof spec.afterUpdate === 'function') {
		createMiddleware.push(
			createApplicationStore.afterGet(spec.afterGet)
		);
	}

	return {
		isGlobal: Boolean(spec.isGlobal),

		create(api, transaction, scope, object, options) {
			return new Promise(function (resolve, reject) {
				const args = {api, transaction, scope, object, options};

				function callback(err, res) {
					if (err) return reject(err);
					return resolve(res);
				}

				composeMiddleware(createMiddleware, callback)(args);
			});
		},

		updateOrCreate(api, transaction, scope, object, options) {
			return new Promise(function (resolve, reject) {
				const args = {api, transaction, scope, object, options};

				function callback(err, res) {
					if (err) return reject(err);
					return resolve(res);
				}

				composeMiddleware(updateOrCreateMiddleware, callback)(args);
			});
		},

		get(api, transaction, scope, object, options) {
			return new Promise(function (resolve, reject) {
				const args = {api, transaction, scope, object, options};

				function callback(err, res) {
					if (err) return reject(err);
					return resolve(res);
				}

				composeMiddleware(getMiddleware, callback)(args);
			});
		}
	};
}
