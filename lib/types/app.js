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
			_emitter: {
				value: emitter
			}
		});

		if (spec.config) {
			Object.defineProperty(this, `config`, {
				enumerable: true,
				value: spec.config
			});
		}

		if (spec.api) {
			Object.defineProperty(this, `api`, {
				enumerable: true,
				value: spec.api
			});
		}
	}

	// Shallowly merge in new properties and deep freeze the result.
	//
	// Returns a new App instance.
	setConfig(newProps) {
		// Makes shallow copies so we can mutate.
		const spec = Object.assign(Object.create(null), this);
		const currentProps = Object.assign(Object.create(null), this.config || Object.create(null));

		// Lock it down so it can't be mutated again.
		spec.config = lib.deepFreeze(Object.assign(currentProps, newProps));

		// Return a new frozen instance.
		return new App(spec);
	}

	// Shallowly merge in new properties and shallowly freeze the result.
	//
	// Returns a new App instance.
	setApi(newProps) {
		// Makes shallow copies so we can mutate.
		const spec = Object.assign(Object.create(null), this);
		const currentProps = Object.assign(Object.create(null), this.api || Object.create(null));

		// Lock it down so it can't be mutated again.
		spec.api = Object.freeze(Object.assign(currentProps, newProps));

		// Return a new frozen instance.
		return new App(spec);
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
		return R.is(App, x);
	}
}

module.exports = App;
