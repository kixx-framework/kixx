'use strict';

class Logger {
	log(level, message, context) {
		level = Logger.levelToInt(level);
		if (context) {
			console.log(message, context); // eslint-disable-line no-console
		} else {
			console.log(message); // eslint-disable-line no-console
		}
		return this;
	}

	fatal(message, context) {
		return this.log(Logger.LEVELS.FATAL, message, context);
	}

	error(message, context) {
		return this.log(Logger.LEVELS.ERROR, message, context);
	}

	warn(message, context) {
		return this.log(Logger.LEVELS.WARN, message, context);
	}

	info(message, context) {
		return this.log(Logger.LEVELS.INFO, message, context);
	}

	debug(message, context) {
		return this.log(Logger.LEVELS.DEBUG, message, context);
	}

	trace(message, context) {
		return this.log(Logger.LEVELS.TRACE, message, context);
	}

	static levelToInt(level) {
		if (typeof level === `number`) {
			return level;
		}

		return Logger.LEVELS[level.toUpperCase()] || 10;
	}
}

Object.defineProperties(Logger, {
	LEVELS: {
		enumerable: true,
		value: Object.freeze({
			FATAL: 60,
			ERROR: 50,
			WARN: 40,
			INFO: 30,
			DEBUG: 20,
			TRACE: 10
		})
	}
});

module.exports = Logger;
