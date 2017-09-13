'use strict';

const EventEmitter = require(`events`);
const R = require(`ramda`);
const lib = require(`../index`);

class App {
	// ### Params:
	// - spec.name *String* Usually the name attribute from package.json
	// - spec.version *String* Usually the version attribute from package.json
	// - spec.appdir *Filepath* A Filepath instance representing the application directory.
	// - spec.environment *String* Usually something like "development" or "production".
	// - spec.logger *Object*
	constructor(spec) {
		spec = spec || {};

		const name = spec.name;
		const version = spec.version;
		const appdir = spec.appdir;
		const environment = spec.environment;
		const logger = spec.logger;
		const config = spec.config;
		const api = spec.api;
		const emitter = spec.emitter || new EventEmitter();

		Object.defineProperties(this, {
			name: {
				enumerable: true,
				value: name
			},
			version: {
				enumerable: true,
				value: version
			},
			appdir: {
				enumerable: true,
				value: appdir
			},
			environment: {
				enumerable: true,
				value: environment
			},
			logger: {
				enumerable: true,
				value: logger
			},
			config: {
				enumerable: true,
				value: config
			},
			api: {
				enumerable: true,
				value: api
			},
			_emitter: {
				value: emitter
			}
		});
	}

	// Shallowly merge in new properties and deep freeze the result.
	//
	// Returns a new App instance.
	setConfig(newProps) {
		// Make a shallow copy of .config so we can mutate.
		const currentProps = Object.assign(Object.create(null), this.config || Object.create(null));

		return new App(R.assoc(
			`config`,
			// Lock it down so it can't be mutated again.
			lib.deepFreeze(Object.assign(currentProps, newProps)),
			this
		));
	}

	// Shallowly merge in new properties and shallowly freeze the result.
	//
	// Returns a new App instance.
	setApi(newProps) {
		// Make a shallow copy of .api so we can mutate.
		const currentProps = Object.assign(Object.create(null), this.api || Object.create(null));

		return new App(R.assoc(
			`api`,
			// Lock it down so it can't be mutated again.
			Object.freeze(Object.assign(currentProps, newProps)),
			this
		));
	}

	on(event, handler) {
		this._emitter.on(event, handler);
	}

	close() {
		this._emitter.emit(`close`);
	}

	isDevMode() {
		return this.environment === `development`;
	}

	static is(x) {
		return x instanceof App;
	}
}

module.exports = App;
