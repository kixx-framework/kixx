'use strict';

const ProgrammerError = require(`./programmer-error`);
const Logger = require(`./logger`);
const EventBus = require(`./event-bus`);
const CommandBus = require(`./command-bus`);

const {assoc, isObject} = require(`../../library`);

const SPECIAL_PROPS = [
	`logger`,
	`eventBus`,
	`commandBus`
];

class ApplicationInterface {
	constructor(spec = {}) {
		Object.assign(this, spec);

		this.logger = isObject(spec.logger) ? spec.logger : Logger.create();
		this.eventBus = isObject(spec.eventBus) ? spec.eventBus : EventBus.create();
		this.commandBus = isObject(spec.commandBus) ? spec.commandBus : CommandBus.create();

		Object.defineProperties(this, {
			set: {
				value: this.set.bind(this)
			}
		});

		Object.freeze(this);
	}

	set(key, prop) {
		if (SPECIAL_PROPS.includes(key)) {
			throw new ProgrammerError(
				`The '${key}' property cannot be set on an ApplicationInterface instance.`
			);
		}
		return new ApplicationInterface(assoc(key, prop, this));
	}

	static create() {
		return new ApplicationInterface();
	}
}

module.exports = ApplicationInterface;
