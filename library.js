'use strict';

const KixxAssert = require(`kixx-assert`);

const {isObject, isPrimitive, isUndefined} = KixxAssert.helpers;

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

exports.merge = function merge(target, ...sources) {
	return sources.reduce((target, source) => {
		if (isUndefined(source)) {
			source = Object.create(null);
		} else if (isPrimitive(source)) {
			source = Object.assign(Object.create(null), source);
		}
		return mergeObject(
			Object.assign(Object.create(null), target),
			source
		);
	}, target);
};

function mergeObject(a, b) {
	return Object.keys(b).reduce((a, k) => {
		const v = b[k];
		if (Array.isArray(v)) {
			a[k] = mergeObject([], v);
		} else if (isObject(v) && isPrimitive(a[k])) {
			a[k] = mergeObject(Object.assign(Object.create(null), a[k]), v);
		} else if (isObject(v)) {
			a[k] = mergeObject(Object.create(null), v);
		} else if (isPrimitive(v)) {
			a[k] = v;
		}
		return a;
	}, a);
}

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