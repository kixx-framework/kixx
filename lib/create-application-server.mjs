import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgrammerError } from 'kixx-server-errors';
import { helpers } from 'kixx-assert';
import createLogger from './create-logger.mjs';
import EventBus from './event-bus.mjs';
import startServers from './servers/start-servers.mjs';
import { readConfigFile } from './file-utils.mjs';

const ALLOWED_CONFIG_FILE_EXTENSIONS = [ '.toml' ];

export default async function createApplicationServer(params) {
	const {
		environment,
		configDirectory,
		serverName,
		applicationFactoryMap,
	} = params;

	if (!helpers.isNonEmptyString(serverName)) {
		throw new ProgrammerError(
			'The serverName provided to ApplicationServer:start() must be a non-empty String',
			{
				fatal: true,
				info: { serverName },
			},
			createApplicationServer
		);
	}

	const configs = await readConfigs(configDirectory);

	const config = configs.find(({ name }) => {
		return name === serverName;
	});

	if (!config) {
		throw new ProgrammerError(
			`No configuration available for serverName "${ serverName }"`,
			{
				fatal: true,
				info: {
					configDirectory,
					serverName,
				},
			},
			createApplicationServer
		);
	}

	// TODO: Data validation for server config files

	const applications = config.applications.map((appConfig) => {
		const factory = applicationFactoryMap.get(appConfig.name);

		return factory(appConfig);
	});

	function applicationRequestHandler() {
		console.log('APPLICATION REQUEST HANDLER');
	}

	const eventBus = new EventBus();

	const logger = createLogger({
		environment,
		name: 'kixxserver',
	});

	return startServers({
		eventBus,
		logger,
		config,
		applicationRequestHandler,
	});
}

async function readConfigs(configDirectory) {
	const entries = await fs.readdir(configDirectory);

	const filepaths = entries
		.filter((entry) => {
			return ALLOWED_CONFIG_FILE_EXTENSIONS.includes(path.extname(entry));
		})
		.map((entry) => {
			return path.join(configDirectory, entry);
		});

	const promises = filepaths.map(readConfigFile);

	return Promise.all(promises);
}
