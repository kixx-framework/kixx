'use strict';

const ProgrammerError = require(`./programmer-error`);
const {isNonEmptyString} = require(`../../library`);

class ComponentRegistry {
	constructor({registry, dependencies}) {
		Object.defineProperties(this, {
			_hasDependency: {
				value: function _hasDependency(name) {
					return dependencies.includes(name);
				}
			},
			_get: {
				value: function _get(name) {
					return registry[name].comp;
				}
			}
		});
	}

	get(name) {
		if (!isNonEmptyString(name)) {
			throw new ProgrammerError(
				`ComponentRegistry#get(name) requires a String name as the first argument.`
			);
		}

		if (!this._hasDependency(name)) {
			throw new ProgrammerError(
				`ComponentRegistry#get(name) can't get undeclared dependency "${name}".`
			);
		}

		return this._get(name);
	}
}

module.exports = ComponentRegistry;
