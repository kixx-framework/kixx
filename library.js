'use strict';

const ramda = require(`ramda`);
const KixxAssert = require(`kixx-assert`);

const {isObject, isPrimitive, isUndefined} = KixxAssert.helpers;

Object.assign(exports, ramda);
Object.assign(exports, KixxAssert.helpers);

exports.assert = KixxAssert.assert;

exports.compact = function compact(list) {
	return list.filter((x) => Boolean(x));
};

exports.mergeDeep = function mergeDeep(target, ...sources) {
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

exports.clone = function clone(x) {
	return exports.mergeDeep(null, x);
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

// The minimum is inclusive and the maximum is exclusive.
exports.random = function random(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
};

exports.regexp = Object.freeze({
	/* eslint-disable no-useless-escape */
	EMAIL: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
	EMAIL_UNICODE: /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i
	/* eslint-enable */
});
