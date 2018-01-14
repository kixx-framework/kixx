'use strict';

const NotImplementedError = require(`./not-implemented-error`);
const ProgrammerError = require(`./programmer-error`);
const Logger = require(`./logger`);
const EventBus = require(`./event-bus`);
const CommandBus = require(`./command-bus`);

const {complement, isFunction, isObject} = require(`../../library`);

const isNotObject = complement(isObject);

class ApplicationInterface {
	constructor(spec) {
		spec = spec || {};
		this.logger = isObject(spec.logger) ? spec.logger : ApplicationInterface.createLogger();
		this.eventBus = isObject(spec.eventBus) ? spec.eventBus : ApplicationInterface.createEventBus();
		this.commandBus = isObject(spec.commandBus) ? spec.commandBus : ApplicationInterface.createCommandBus();
		this.createTransaction = isFunction(spec.createTransaction) ? spec.createTransaction : this.createTransaction;
		Object.freeze(this);
	}

	createTransaction() {
		throw new NotImplementedError(
			`ApplicationInterface#createTransaction() must be passed to the ApplicationInterface constructor`
		);
	}

	updateLogger(options) {
		return this.assign({
			logger: this.logger.clone(options)
		});
	}

	assign(props) {
		if (isNotObject(props)) {
			throw new ProgrammerError(
				`ApplicationInterface#assign() expects props to be an Object`
			);
		}

		return new ApplicationInterface(Object.assign(
			Object.create(null),
			this,
			props
		));
	}

	static createLogger() {
		return Logger.create({name: `kixx-logger`, level: `debug`});
	}

	static createEventBus() {
		return EventBus.create();
	}

	static createCommandBus() {
		return CommandBus.create();
	}
}

module.exports = ApplicationInterface;
