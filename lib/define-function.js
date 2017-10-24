'use strict';

const ProgrammerError = require(`./classes/programmer-error`);

const {isArray} = require(`./library`);

module.exports = function defineFunction({name, params, func}) {
	if (!isArray(params)) {
		throw new ProgrammerError(`defineFunction(def) def.params must be an Array`);
	}
	func.name = name;
	return func;
};
