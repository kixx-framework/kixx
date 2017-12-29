'use strict';

const Promise = require(`bluebird`);

const StackedError = require(`./stacked-error`);
const ProgrammerError = require(`./programmer-error`);

const {isFunction, isNonEmptyString, isString, compact} = require(`../../library`);

class CommandBus {
	constructor() {
		Object.defineProperties(this, {
			_commandRoutes: {
				value: []
			}
		});
	}

	addCommandHandler(type, pattern, handler) {
		if (!isNonEmptyString(type)) {
			throw new ProgrammerError(`CommandBus#addCommandHandler() requires type String as the first parameter.`);
		}
		if (!isString(pattern)) {
			throw new ProgrammerError(`CommandBus#addCommandHandler() requires pattern String as the second parameter.`);
		}
		if (!isFunction(handler)) {
			throw new ProgrammerError(`CommandBus#addCommandHandler() requires handler Function as the third parameter.`);
		}

		pattern = `${type}:${pattern}`;
		this._commandRoutes.push({pattern, handler});
		return this;
	}

	command(type, patternString, args = {}) {
		if (!isNonEmptyString(type)) {
			throw new ProgrammerError(`CommandBus#command() requires an type String`);
		}
		if (!isNonEmptyString(patternString)) {
			throw new ProgrammerError(`CommandBus#command() requires a patternString`);
		}

		patternString = `${type}:${patternString}`;
		const match = CommandBus.findBestMatch(this._commandRoutes, patternString);

		if (!match) {
			return Promise.reject(new ProgrammerError(
				`CommandBus has no handler for ${patternString}`
			));
		}

		const {handler, pattern} = match;

		let promise;
		try {
			promise = handler(args);
		} catch (err) {
			return Promise.reject(new StackedError(
				`Synchronous Error in CommandBus handler for "${pattern}"`,
				err
			));
		}

		if (!promise || !isFunction(promise.catch || !isFunction(promise.then))) {
			return Promise.reject(new ProgrammerError(
				`CommandBus handler for "${pattern}" did not return a Promise`
			));
		}

		return promise;
	}

	static findBestMatch(routes, path) {
		// Find all matches, order them by the specificity of the pattern
		// (longest length/most specific first), then return the first one.
		return compact(routes.map((route) => {
			const {handler, pattern} = route;
			if (!path.startsWith(pattern)) return false;
			return {handler, pattern};
		})).sort((a, b) => {
			if (a.pattern.length === b.pattern.length) {
				return 0;
			}
			return b.pattern.length > a.pattern.length ? 1 : -1;
		})[0];
	}
}

module.exports = CommandBus;
