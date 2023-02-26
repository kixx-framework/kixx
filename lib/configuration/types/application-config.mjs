import KixxAssert from 'kixx-assert';
import { deepFreeze } from 'kixx-lib-es6';
import HostnameConfig from './hostname-config.mjs';
import { ENVIRONMENTS } from '../../constants.mjs';

const { isNonEmptyString } = KixxAssert.helpers;

export default class ApplicationConfig {

	name = null;
	environment = null;
	preferEncrypted = false;
	ports = [];
	hostnames = [];

	constructor(spec) {

		this.name = spec.name || null;
		this.environment = spec.environment || ENVIRONMENTS.PRODUCTION;
		this.ports = spec.ports || [];
		this.hostnames = spec.hostnames || [];
		this.preferEncrypted = Boolean(spec.preferEncrypted);

		deepFreeze(this);
	}

	static fromConfigFile(servers, config) {
		// TODO: Validate server application configuration.
		const { name } = config;

		const serverPorts = servers.map((server) => server.port);

		const encryptedServerPorts = servers
			.filter((server) => server.encrypted)
			.map((server) => server.port);

		const environment = isNonEmptyString(config.environment)
			? config.environment
			: ENVIRONMENTS.PRODUCTION;

		const ports = Array.isArray(config.ports)
			? config.ports.filter((port) => serverPorts.includes(port))
			: serverPorts;

		const tlsPorts = ports.filter((port) => {
			return encryptedServerPorts.includes(port);
		});

		const preferEncrypted = Boolean(tlsPorts.length);

		const hostnamConfigs = Array.isArray(config.hostnames) ? config.hostnames : [];

		const hostnames = hostnamConfigs.map(({ hostname, certificate }) => {
			return HostnameConfig.fromConfigFile(preferEncrypted, { hostname, certificate });
		});

		return new ApplicationConfig({
			name,
			environment,
			ports,
			hostnames,
			preferEncrypted,
		});
	}
}
