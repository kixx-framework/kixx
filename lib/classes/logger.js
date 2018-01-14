'use strict';

const EventEmitter = require(`events`);
const {ProgrammerError} = require(`kixx`);

const {isNonEmptyString, isFunction} = require(`kixx/library`);

// spec.name
// spec.level - fatal, error, warn, info, debug, trace
// spec.prettyLog - Boolean
class Logger {
	constructor(spec = {}) {
		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: spec.name
			},
			level: {
				enumerable: true,
				value: spec.level
			},
			prettyLog: {
				enumerable: true,
				value: Boolean(spec.prettyLog)
			},
			emitter: {
				value: new EventEmitter
			}
		});

		this.fatal = this.fatal.bind(this);
		this.error = this.error.bind(this);
		this.warn = this.warn.bind(this);
		this.info = this.info.bind(this);
		this.debug = this.debug.bind(this);
		this.trace = this.trace.bind(this);
		this.clone = this.clone.bind(this);
		this.onMessage = this.onMessage.bind(this);
		this.onError = this.onError.bind(this);

		Object.freeze(this);
	}

	onError(handler) {
		if (!isFunction(handler)) {
			throw new ProgrammerError(
				`Expected a handler Function to be passed to Logger#onError()`
			);
		}

		this.emitter.on(`error`, handler);
		return this;
	}

	onMessage(level, handler) {
		if (!isNonEmptyString(level)) {
			throw new ProgrammerError(
				`Expected a level String to be passed to Logger#onMessage()`
			);
		}
		if (!isFunction(handler)) {
			throw new ProgrammerError(
				`Expected a handler Function to be passed to Logger#onMessage()`
			);
		}

		this.emitter.on(`message:${level}`, handler);
		return this;
	}

	fatal(message, object) {
		if (this.prettyLog) return Logger.prettyLog(`FATAL`, message, object);
		this.emitter.emit(`message:fatal`, Object.freeze({
			level: `fatal`,
			message,
			object
		}));
		return this;
	}
	error(message, object) {
		if (this.prettyLog) return Logger.prettyLog(`ERROR`, message, object);
		this.emitter.emit(`message:error`, Object.freeze({
			level: `error`,
			message,
			object
		}));
		return this;
	}
	warn(message, object) {
		if (this.prettyLog) return Logger.prettyLog(`WARN`, message, object);
		this.emitter.emit(`message:warn`, Object.freeze({
			level: `warn`,
			message,
			object
		}));
		return this;
	}
	info(message, object) {
		if (this.prettyLog) return Logger.prettyLog(`INFO`, message, object);
		this.emitter.emit(`message:info`, Object.freeze({
			level: `info`,
			message,
			object
		}));
		return this;
	}
	debug(message, object) {
		if (this.prettyLog) return Logger.prettyLog(`DEBUG`, message, object);
		this.emitter.emit(`message:debug`, Object.freeze({
			level: `debug`,
			message,
			object
		}));
		return this;
	}
	trace(message, object) {
		if (this.prettyLog) return Logger.prettyLog(`TRACE`, message, object);
		this.emitter.emit(`message:trace`, Object.freeze({
			level: `trace`,
			message,
			object
		}));
		return this;
	}

	clone(spec) {
		return new Logger(Object.assign(
			Object.create(null),
			this,
			spec
		));
	}

	static prettyLog(level, message, object) {
		/* eslint-disable no-console */
		console.log(`${Logger.getCurrentTimeString()} - ${level} - ${message} - JSON:`);
		if (object) {
			console.log(JSON.stringify(object, null, 2));
		}
		/* eslint-enable */
	}

	static getCurrentTimeString() {
		const d = new Date();
		return `${d.toTimeString().slice(0, 8)}.${d.getMilliseconds()}`;
	}

	// spec.name
	// spec.level - fatal, error, warn, info, debug, trace
	static create(spec) {
		spec = spec || {};
		if (!isNonEmptyString(spec.name)) {
			throw new ProgrammerError(`Logger.create(spec) requires spec.name String`);
		}
		if (!isNonEmptyString(spec.level)) {
			throw new ProgrammerError(`Logger.create(spec) requires spec.level String`);
		}

		return new Logger(spec);
	}
}

module.exports = Logger;
