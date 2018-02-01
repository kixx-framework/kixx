'use strict';

const ramda = require(`ramda`);
const KixxAssert = require(`kixx-assert`);

const protoToString = Object.prototype.toString;
const {isObject, isPrimitive, isUndefined} = KixxAssert.helpers;

Object.assign(exports, KixxAssert.helpers);
Object.assign(exports, ramda);

exports.isEmpty = KixxAssert.helpers.isEmpty;

exports.assert = KixxAssert.assert;

function compact(list) {
	return list.filter((x) => Boolean(x));
}
exports.compact = compact;

function mergeDeep(target, ...sources) {
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
}
exports.mergeDeep = mergeDeep;

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

// TODO: Test this new clone implementation.
function clone(obj) {
	const type = typeof obj;

	if (obj === null || type !== `object` && type !== `function`) return obj;

	if (Array.isArray(obj)) return obj.map(clone);

	switch (type) {
		case `function`:
			return obj;
		case `object`:
			if (protoToString.call(obj) === `[object Date]`) {
				return new Date(obj.toString());
			}
			return Object.getOwnPropertyNames(obj).reduce((newObj, key) => {
				newObj[key] = clone(obj[key]);
				return newObj;
			}, {});
		default:
			return obj;
	}
}
exports.clone = clone;

// TODO: Test this deepFreeze implementation.
function deepFreeze(obj) {
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
}
exports.deepFreeze = deepFreeze;

// The minimum is inclusive and the maximum is exclusive.
const random = ramda.curry((min, max) => {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
});
exports.random = random;

const sampleOne = (list) => {
	return list[random(0, list.length)];
};
exports.sampleOne = sampleOne;

const clamp = ramda.curry((min, max, n) => {
	max = max >= 1 ? max : 1;
	if (typeof n !== `number` || n < min) return min;
	if (n >= max) return max - 1;
	return n;
});
exports.clamp = clamp;

function capitalize(str) {
	if (typeof str !== `string`) return str;
	return str[0].toUpperCase() + str.slice(1);
}
exports.capitalize = capitalize;

exports.regexp = Object.freeze({
	/* eslint-disable no-useless-escape */
	EMAIL: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
	EMAIL_UNICODE: /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i
	/* eslint-enable */
});
