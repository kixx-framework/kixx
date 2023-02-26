import { deepFreeze } from 'kixx-lib-es6';
import ServerConfig from './server-config.mjs';
import ApplicationConfig from './application-config.mjs';

export default class ApplicationServerConfig {
	name = null;
	ssl_certificate_directory = null;
	servers = [];
	applications = [];

	constructor(spec) {

		this.name = spec.name || null;
		this.ssl_certificate_directory = spec.ssl_certificate_directory || null;
		this.servers = spec.servers || [];
		this.applications = spec.applications || [];

		deepFreeze(this);
	}

	static fromConfigFile(config, applicationConfigs) {
		// TODO: Data validation for server config files

		const servers = config.servers.map(ServerConfig.fromConfigFile);

		const applications = applicationConfigs.map((appConfig) => {
			return ApplicationConfig.fromConfigFile(servers, appConfig);
		});

		return new ApplicationServerConfig({
			ssl_certificate_directory: config.ssl_certificate_directory,
			name: config.name,
			servers,
			applications,
		});
	}
}
