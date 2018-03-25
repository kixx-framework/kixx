'use strict';

const ramda = require(`ramda`);
const KixxAssert = require(`kixx-assert`);

const protoToString = Object.prototype.toString;

Object.assign(exports, KixxAssert.helpers);
Object.assign(exports, ramda);

exports.isEmpty = KixxAssert.helpers.isEmpty;

exports.assert = KixxAssert.assert;

function compact(list) {
	return list.filter((x) => Boolean(x));
}
exports.compact = compact;

function mergeDeep() {
	const objects = Array.prototype.slice.call(arguments);

	return objects.reduce((target, source) => {
		if (typeof source !== 'object' || Array.isArray(source) || source === null) return target;
		return mergeObject(target, source);
	}, {});
}
exports.mergeDeep = mergeDeep;

function mergeObject(target, source) {
	return Object.keys(source).reduce((target, key) => {
		const v = source[key];

		if (typeof v !== 'object' || v === null) {
			target[key] = v;
		} else if (Array.isArray(v)) {
			target[key] = v.map(clone);
		} else if (protoToString.call(v) === '[object Date]') {
			target[key] = new Date(v.toString());
		} else {
			target[key] = mergeObject({}, v);
		}

		return target;
	}, target);
}

function clone(obj) {
	const type = typeof obj;

	if (obj === null || type !== 'object') return obj;

	if (Array.isArray(obj)) return obj.map(clone);

	if (protoToString.call(obj) === '[object Date]') {
		return new Date(obj.toString());
	}

	// Object.getOwnProperties() returns non-enumerable props, where
	// Object.keys only returns *enumerable* props.
	return Object.getOwnPropertyNames(obj).reduce((newObj, key) => {
		newObj[key] = clone(obj[key]);
		return newObj;
	}, {});
}
exports.clone = clone;

function deepFreeze(obj) {
	if (obj === null || typeof obj !== 'object') return obj;

	Object.freeze(obj);

	if (Array.isArray(obj)) {
		obj.forEach((prop) => deepFreeze(prop));
	} else {
		// Object.getOwnProperties() returns non-enumerable props, where
		// Object.keys only returns *enumerable* props.
		Object.getOwnPropertyNames(obj).forEach((key) => deepFreeze(obj[key]));
	}

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
