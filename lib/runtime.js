'use strict';

class Runtime {
	constructor() {
		Object.defineProperties(this, {
			logger: {
				configurable: true,
				enumerable: true,
				writable: true,
				value: null
			},
			config: {
				configurable: true,
				enumerable: true,
				writable: true,
				value: null
			},
			api: {
				configurable: true,
				enumerable: true,
				writable: true,
				value: null
			},
			plugins: {
				configurable: false,
				enumerable: false,
				writable: false,
				value: []
			}
		});
	}

	setLogger(logger, name) {
		name = name || 'KixxRuntime';

		Object.defineProperty(this, 'logger', {
			configurable: false,
			enumerable: true,
			writable: false,
			value: logger || Logger.create({ name })
		});

		return this;
	}

	setConfig(config) {
		Object.defineProperty(this, 'config', {
			configurable: false,
			enumerable: true,
			writable: false,
			value: config
		});

		return this;
	}

	setApi(initialApi) {
		const api = API.create(Object.assign({}, initialApi));

		Object.defineProperty(this, 'api', {
			configurable: false,
			enumerable: true,
			writable: false,
			value: api
		});

		return this;
	}

	configure(config) {
		if (this.config) {
			this.logger.warn('configuration already complete');
			return Promise.resolve(this);
		}

		if (!this.logger) this.setLogger();

		const logLevel = returnSafe(() => config.Logger.level);

		if (isNonEmptyString(logLevel)) {
			this.logger.setLevel(logLevel);
		}

		this.logger.info('intializing configuration');

		let waitForConfig;

		if (config && isFunction(config.initialize)) {
			waitForConfig = userDefinedConfig.initialize();
		} else if (isObject(config)) {
			waitForConfig = Config.create(config).initialize();
		} else {
			waitForConfig = Config.create({}).initialize();
		}

		if (!isPromise(waitForConfig)) {
			waitForConfig = Promise.resolve(waitForConfig);
		}

		return waitForConfig.then((newConfig) => {
			this.setConfig(newConfig);
		});
	}

	registerPlugins(plugins) {
		this.logger.info('register plugins');
		const { config, logger } = this;

		plugins.forEach((Plugin) => {
			this.plugins.push(Plugin.create({
				config,
				logger
			}));
		});

		Object.freeze(this.plugins);

		return this;
	}

	initializePlugins(initialApi) {
		this.logger.info('initialize plugins');

		const { api } = this.setApi(initialApi || {});

		return this.plugins.reduce((promise, plugin) => {
			return promise.then(() => plugin.initialize(api));
		}, Promise.resolve(null)).then(() => this);
	}

	initialize(options = {}) {
		const {
			name,
			initialConfig,
			logger,
			initialApi,
			plugins
		} = options;

		this.setLogger(logger, name);

		return this.configure(initialConfig).then(() => {
			return this.registerPlugins(plugins);
		}).then(() => {
			return this.initializePlugins(initialApi);
		});
	}

	static create() {
		return new Runtime();
	}
}

module.exports = Runtime;
