import fs from 'node:fs';
import path from 'node:path';
import { helpers } from 'kixx-assert';
import { isDirectory, readConfigFile } from '../file-utils.mjs';
import { ENVIRONMENTS } from '../constants.mjs';

const ALLOWED_CONFIG_FILE_EXTENSIONS = [ '.toml' ];

export default {
	readConfigTree,
	readConfigData,
	findHostApplication,
	getPreferredHost,
	getPreferredPort,
};

function readConfigTree(configDirectory) {
	const promises = fs.readdirSync(configDirectory)
		.map(joinFilePath(configDirectory))
		.filter(filterPathsByDirectory)
		.map(readConfigData);

	return Promise.all(promises);
}

async function readConfigData(namespacedDirectory) {

	// Choose the last file with an allowed file extension in the root
	// config directory as the server config file.
	const serverConfigFilepath = fs.readdirSync(namespacedDirectory)
		.map(joinFilePath(namespacedDirectory))
		.filter(filterFilepathsByAllowedExtension)
		.pop();

	const appConfigDirectory = path.join(namespacedDirectory, 'applications');

	const appConfigFilepaths = fs.readdirSync(appConfigDirectory)
		.map(joinFilePath(appConfigDirectory))
		.filter(filterFilepathsByAllowedExtension);

	const config = await readConfigFile(serverConfigFilepath);
	const applicationConfigs = await Promise.all(appConfigFilepaths.map(readConfigFile));

	return mapConfigData(config, applicationConfigs);
}

function findHostApplication(applications, requestHostname, requestPort) {
	return applications.find(({ ports, hostnames }) => {

		for (let y = 0; y < hostnames.length; y = y + 1) {
			const { hostname } = hostnames[y];

			if (hostname && hostname === requestHostname) {
				return true;
			}
		}

		for (let n = 0; n < ports.length; n = n + 1) {
			if (requestPort === ports[n]) {
				return true;
			}
		}

		return false;
	});
}

function getPreferredHost(appConfig) {
	if (appConfig.hostnames && appConfig.hostnames.length > 0) {
		return appConfig.hostnames[0].hostname;
	}

	return null;
}

function getPreferredPort(appConfig) {
	if (appConfig.ports && appConfig.ports.length > 0) {
		return appConfig.ports[0];
	}

	return null;
}

function mapConfigData(config, applicationConfigs) {

	// TODO: Data validation for server config files

	const servers = config.servers.map(({ port, encrypted }) => {
		return { port, encrypted: Boolean(encrypted) };
	});

	const serverPorts = servers.map((server) => server.port);

	const encryptedServerPorts = servers
		.filter((server) => server.encrypted)
		.map((server) => server.port);

	const applications = applicationConfigs.map((appConfig) => {
		const { name } = appConfig;

		const environment = helpers.isNonEmptyString(appConfig.environment)
			? appConfig.environment
			: ENVIRONMENTS.PRODUCTION;

		const ports = Array.isArray(appConfig.ports)
			? appConfig.ports.filter((port) => serverPorts.includes(port))
			: servers.map((server) => server.port);

		const tlsPorts = ports.filter((port) => {
			return encryptedServerPorts.includes(port);
		});

		const preferEncrypted = Boolean(tlsPorts.length);

		let hostnames = Array.isArray(appConfig.hostnames) ? appConfig.hostnames : [];

		hostnames = hostnames.map(({ hostname, certificate }) => {
			return {
				hostname,
				preferEncrypted: Boolean(preferEncrypted && helpers.isNonEmptyString(certificate)),
				certificate,
			};
		});

		return {
			name,
			environment,
			ports,
			preferEncrypted,
			hostnames,
		};
	});

	return {
		ssl_certificate_directory: config.ssl_certificate_directory,
		name: config.name,
		servers,
		applications,
	};
}

function joinFilePath(basepath) {
	return function (filename) {
		return path.join(basepath, filename);
	};
}

function filterFilepathsByAllowedExtension(filepath) {
	return ALLOWED_CONFIG_FILE_EXTENSIONS.includes(path.extname(filepath));
}

function filterPathsByDirectory(filepath) {
	return isDirectory(filepath);
}
