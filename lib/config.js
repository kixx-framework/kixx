'use strict';

class Config {
	constructor(initialConfig) {
		this.mergeNewConfig(initialConfig);
	}

	mergeNewConfig(newConfig) {
		return entries(newConfig).reduce((config, [ key, val ]) => {
			config[key] = deepFreeze(val);
			return config;
		}, this);
	}

	initialize() {
		return new Promise((resolve, reject) => {
			const { localConfigPath } = this;

			if (isNonEmptyString(localConfigPath)) {
				try {
					const localConfig = require(localConfigPath);
					this.mergeNewConfig(localConfig);
				} catch (err) {
					return reject(new Error(
						`Error while loading local config from path ${localConfigPath} : ${err.message}`
					));
				}

				return resolve(this);
			}
		});
	}

	getPlugin(name) {
		return returnSafe(() => {
			return this.plugins[name];
		}, Object.create(null));
	}

	static create(initialConfig) {
		const clonedConfig = initialConfig ? clone(initialConfig) : {};
		return new Config(clonedConfig);
	}
}

module.exports = Config;
