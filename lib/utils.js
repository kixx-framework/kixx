'use strict';

const R = require('ramda');

Object.keys(R).forEach((key) => {
	exports[key] = R[key];
});

function getName(thing) {
	return (thing && thing.constructor && thing.constructor.name) || R.type(thing);
}
exports.getName = getName;

function toArray(x) {
	return [ x ];
}
exports.toArray = toArray;
