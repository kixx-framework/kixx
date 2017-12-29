'use strict';

const crypto = require(`crypto`);

const toString = Object.prototype.toString;
const NULL = `null`;
const UNDEFINED = `undefined`;
const FUNCTION = `function`;
const OBJECT = `object`;

module.exports = function computeObjectHash(x) {
	const hash = crypto.createHash(`sha256`);
	hash.update(computeString(x));
	return hash.digest(`hex`);
};

function computeString(x) {
	if (x === null) {
		return NULL;
	}
	if (typeof x === UNDEFINED) {
		return UNDEFINED;
	}
	if (typeof x === FUNCTION) {
		return `function ${x.name}()`;
	}
	if (Array.isArray(x)) {
		const s = x.map(computeString).join(`,`);
		return `[${s}]`;
	}
	if (typeof x !== OBJECT) {
		return toString.call(x);
	}

	const s = Object.keys(x).map((key) => {
		return `${key}:${computeString(x[key])}`;
	}).join(`,`);

	return `{${s}}`;
}
