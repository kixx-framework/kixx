'use strict';

const crypto = require(`crypto`);
const {type} = require(`../library`);

const toString = Object.prototype.toString;
const NULL = `null`;
const UNDEFINED = `undefined`;
const STRING = `string`;
const SYMBOL = `symbol`;
const NUMBER = `number`;
const TRUE = `true`;
const FALSE = `false`;
const FUNCTION = `function`;
const DATE = `Date`;
const OBJECT = `object`;

module.exports = function computeObjectHash(x) {
	const hash = crypto.createHash(`sha1`);
	hash.update(computeString(x));
	return hash.digest(`base64`);
};

function computeString(x) {
	switch (x) {
	case null: return NULL;
	case true: return TRUE;
	case false: return FALSE;
	}

	// !GOTCHA: isNaN(undefined) === true
	// if (isNaN(x)) {
	// 	return NAN;
	// }

	switch (typeof x) {
	case STRING: return x;
	case UNDEFINED: return UNDEFINED;
	case NUMBER:
	case SYMBOL:
		return x.toString();
	case FUNCTION: return `function ${x.name}()`;
	}

	if (Array.isArray(x)) {
		const s = x.map(computeString).join(`,`);
		return `[${s}]`;
	}
	if (type(x) === DATE) {
		return x.toISOString();
	}
	if (typeof x !== OBJECT) {
		return toString.call(x);
	}

	const s = Object.keys(x).sort().map((key) => {
		return `${key}:${computeString(x[key])}`;
	}).join(`,`);

	return `{${s}}`;
}
