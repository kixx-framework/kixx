import { deepFreeze } from 'kixx-lib-es6';

export default class ServerConfig {
	port = null;
	encrypted = false;

	constructor(spec) {

		this.port = spec.port || null;
		this.encrypted = Boolean(spec.encrypted);

		deepFreeze(this);
	}

	static fromConfigFile(config) {
		// TODO: Data validation for server config files
		return new ServerConfig(config);
	}
}
