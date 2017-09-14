'use strict';

const kixxAssert = require(`kixx-assert`);

exports.isString = kixxAssert.helpers.isString;
exports.isNonEmptyString = kixxAssert.helpers.isNonEmptyString;
exports.isFunction = kixxAssert.helpers.isFunction;
exports.isArray = kixxAssert.helpers.isArray;

// Calls `Object.freeze()` recursively on the passed in Object.
// deepFreeze() will skip the `arguemnts`, `caller`, `callee` and `prototype`
// properties of a Function. deepFreeze() will throw if passed null or
// undefined just like `Object.freeze()` would.
exports.deepFreeze = (obj) => {
	Object.freeze(obj);

	Object.getOwnPropertyNames(obj).forEach((key) => {
		if (typeof obj === `function` &&
				(key === `arguments` ||
				key === `caller` ||
				key === `callee` ||
				key === `prototype`)) {
			return;
		}

		const prop = obj[key];
		if (prop !== null && (typeof prop === `object` || typeof prop === `function`)) {
			exports.deepFreeze(prop);
		}
	});

	return obj;
};

exports.invariant = (message) => {
	return `INVARIANT: ${message}`;
};
