'use strict';

const R = require('ramda');

function getName(thing) {
	return (thing && thing.constructor && thing.constructor.name) || R.type(thing);
}
exports.getName = getName;
