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

	let hasObject = false;
	let target;

	for (let i = 0; i < objects.length; i++) {
		const source = objects[i];

		if (Array.isArray(source)) {
			if (hasObject) continue;
			target = source.map(clone);
			continue;
		}

		if (typeof source !== 'object' || source === null) {
			if (hasObject) continue;
			target = source;
			continue;
		}

		if (protoToString.call(source) === '[object Date]') {
			if (hasObject) continue;
			target = new Date(source.toString());
			continue;
		}

		if (!hasObject) {
			target = {};
			hasObject = true;
		}

		target = mergeObject(target, source);
	}

	return target;
}
exports.mergeDeep = mergeDeep;

function mergeObject(target, source) {
	const keys = Object.keys(source);

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const v = source[key];
		const t = target[key];

		if (typeof v !== 'object' || v === null) {
			target[key] = v;
			continue;
		}
		if (Array.isArray(v)) {
			target[key] = v.map(clone);
			continue;
		}
		if (protoToString.call(v) === '[object Date]') {
			target[key] = new Date(v.toString());
			continue;
		}
		if (typeof t !== 'object' || t === null) {
			target[key] = clone(v);
			continue;
		}

		target[key] = mergeObject(t, v);
	}

	return target;
}

function clone(obj) {
	const type = typeof obj;

	if (obj === null || type !== 'object') return obj;

	if (Array.isArray(obj)) return obj.map(clone);

	if (protoToString.call(obj) === '[object Date]') {
		return new Date(obj.toString());
	}

	const keys = Object.keys(obj);
	const newObj = {};

	for (let i = 0; i < keys.length; i++) {
		const k = keys[i];
		newObj[k] = clone(obj[k]);
	}

	return newObj;
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
