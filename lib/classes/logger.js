'use strict';

const EventEmitter = require(`events`);
const ProgrammerError = require(`./programmer-error`);

const {complement, has, isBoolean, isFunction, isNonEmptyString, equal} = require(`../../library`);

const isNotEqual = complement(equal);
const isNotBoolean = complement(isBoolean);

const LEVELS = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60
};

// spec.level - fatal, error, warn, info, debug, trace
// spec.prettyLog - Boolean
class Logger {
	constructor() {
		Object.defineProperties(this, {
			emitter: {
				value: new EventEmitter()
			},
			level: {
				writable: true,
				value: LEVELS.debug
			},
			prettyLog: {
				writable: true,
				value: false
			},
			fatal: {
				enumerable: true,
				value: this.fatal.bind(this)
			},
			error: {
				enumerable: true,
				value: this.error.bind(this)
			},
			warn: {
				enumerable: true,
				value: this.warn.bind(this)
			},
			info: {
				enumerable: true,
				value: this.info.bind(this)
			},
			debug: {
				enumerable: true,
				value: this.debug.bind(this)
			},
			trace: {
				enumerable: true,
				value: this.trace.bind(this)
			}
		});
	}

	addErrorHandler(handler) {
		if (!isFunction(handler)) {
			throw new ProgrammerError(
				`Expected a handler Function to be passed to Logger#addErrorHandler()`
			);
		}
		this.emitter.on(`error`, handler);
		return this;
	}

	addMessageHandler(level, handler) {
		if (!isNonEmptyString(level)) {
			throw new ProgrammerError(
				`Expected a level String to be passed to Logger#addMessageHandler()`
			);
		}
		if (!isFunction(handler)) {
			throw new ProgrammerError(
				`Expected a handler Function to be passed to Logger#addMessageHandler()`
			);
		}

		this.emitter.on(`message:${level}`, handler);
		return this;
	}

	addUpdateHandler(handler) {
		if (!isFunction(handler)) {
			throw new ProgrammerError(
				`Expected a handler Function to be passed to Logger#addUpdateHandler()`
			);
		}
		this.emitter.on(`update`, handler);
		return this;
	}

	update(options) {
		options = options || {};

		const hasLevel = has(`level`, options);
		const hasPrettyLog = has(`prettyLog`, options);

		if (hasLevel && !isNonEmptyString(options.level)) {
			throw new ProgrammerError(
				`Expected options.level to be a String in Logger#update()`
			);
		}
		if (hasPrettyLog && isNotBoolean(options.prettyLog)) {
			throw new ProgrammerError(
				`Expected options.prettyLog to be a Boolean in Logger#update()`
			);
		}

		const {level, prettyLog} = options;

		if (hasLevel) {
			const levelN = Number.isInteger(level) ? level : LEVELS[level];
			if (!Number.isInteger(levelN)) {
				throw new ProgrammerError(
					`Invalid level '${level}'. Valid values: '${Object.keys(LEVELS).join(`','`)}'.`
				);
			}
			if (isNotEqual(this.level, levelN)) {
				this.level = levelN;
				this.emitter.emit(`update`, {level});
			}
		}

		if (hasPrettyLog && isNotEqual(this.prettyLog, prettyLog)) {
			this.prettyLog = prettyLog;
		}

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
		if (this.level > 50) return this;
		if (this.prettyLog) return Logger.prettyLog(`ERROR`, message, object);
		this.emitter.emit(`message:error`, Object.freeze({
			level: `error`,
			message,
			object
		}));
		return this;
	}
	warn(message, object) {
		if (this.level > 40) return this;
		if (this.prettyLog) return Logger.prettyLog(`WARN`, message, object);
		this.emitter.emit(`message:warn`, Object.freeze({
			level: `warn`,
			message,
			object
		}));
		return this;
	}
	info(message, object) {
		if (this.level > 30) return this;
		if (this.prettyLog) return Logger.prettyLog(`INFO`, message, object);
		this.emitter.emit(`message:info`, Object.freeze({
			level: `info`,
			message,
			object
		}));
		return this;
	}
	debug(message, object) {
		if (this.level > 20) return this;
		if (this.prettyLog) return Logger.prettyLog(`DEBUG`, message, object);
		this.emitter.emit(`message:debug`, Object.freeze({
			level: `debug`,
			message,
			object
		}));
		return this;
	}
	trace(message, object) {
		if (this.level > 10) return this;
		if (this.prettyLog) return Logger.prettyLog(`TRACE`, message, object);
		this.emitter.emit(`message:trace`, Object.freeze({
			level: `trace`,
			message,
			object
		}));
		return this;
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

	static create() {
		return new Logger();
	}
}

module.exports = Logger;
