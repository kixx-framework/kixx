'use strict';

const ProgrammerError = require(`./programmer-error`);
const Logger = require(`./logger`);

const {has, isObject} = require(`../../library`);

const SPECIAL_PROPS = [
	`logger`,
	`eventBus`,
	`commandBus`
];

class ApplicationInterface {
	constructor(spec = {}) {
		Object.assign(this, spec);

		this.logger = isObject(spec.logger) ? spec.logger : Logger.create();

		Object.defineProperties(this, {
			set: {
				value: this.set.bind(this)
			}
		});
	}

	set(key, prop) {
		if (SPECIAL_PROPS.includes(key)) {
			throw new ProgrammerError(
				`The '${key}' property cannot be set on an ApplicationInterface instance.`
			);
		}
		if (has(key, this)) {
			throw new ProgrammerError(
				`The '${key}' property is already set. Cannot set an existing property on an ApplicationInterface instance.`
			);
		}

		Object.defineProperty(this, key, {
			enumerable: true,
			value: prop
		});

		return this;
	}

	static create() {
		return new ApplicationInterface();
	}
}

module.exports = ApplicationInterface;
