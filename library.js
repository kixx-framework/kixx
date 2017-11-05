'use strict';

const KixxAssert = require(`kixx-assert`);

Object.assign(exports, KixxAssert.helpers);

exports.assert = KixxAssert.assert;

exports.append = function append(item, list) {
	list = list.slice();
	list.push(item);
	return list;
};

exports.compact = function compact(list) {
	return list.filter((x) => Boolean(x));
};

exports.assoc = function assoc(key, value, hash) {
	hash = Object.assign({}, hash);
	hash[key] = value;
	return hash;
};

exports.deepFreeze = function deepFreeze(obj) {
	Object.freeze(obj);
	Object.getOwnPropertyNames(obj).forEach((key) => {
		if (typeof obj === `function` &&
			(key === `arguments` || key === `caller` || key === `callee` || key === `prototype`)) {
			return;
		}

		const prop = obj[key];
		if (prop !== null && (typeof prop === `object` || typeof prop === `function`)) {
			deepFreeze(prop);
		}
	});

	return obj;
};