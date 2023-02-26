import { getFullStack, ProgrammerError } from 'kixx-server-errors';
import KixxAssert from 'kixx-assert';
import createLogger from './create-logger.mjs';
import EventBus from './event-bus.mjs';
import { ErrorEvent } from './events.mjs';
import readConfiguration from './configuration/read-configuration.mjs';
import startServers from './servers/start-servers.mjs';
import createApplicationRequestHandler from './servers/create-application-request-handler.mjs';

const { isNonEmptyString } = KixxAssert.helpers;

export default async function createApplicationServer(params) {
	const {
		// The environment value is the environment for the servers, NOT the application.
		environment,
		configDirectory,
		serverName,
		applicationFactoryMap,
	} = params;

	if (!isNonEmptyString(serverName)) {
		throw new ProgrammerError(
			'The serverName parameter must be a non-empty String',
			{
				fatal: true,
				info: { serverName },
			}
		);
	}

	const configs = await readConfiguration({ configDirectory });

	const config = configs.find(({ name }) => {
		return name === serverName;
	});

	if (!config) {
		throw new ProgrammerError(
			`No configuration available for serverName "${ serverName }"`,
			{
				fatal: true,
				info: { configDirectory, serverName },
			}
		);
	}

	throw new Error('STOP');

	const logger = createLogger({
		environment,
		name: 'kixxserver',
	});

	const eventBus = new EventBus();

	eventBus.on(ErrorEvent.NAME, (ev) => {
		logger.error('error event emitted:', ev);
		logger.error(getFullStack(ev.cause));
	});

	const applicationsPromise = config.applications.reduce((promise, appConfig) => {
		return promise.then((appMap) => {
			const factory = applicationFactoryMap.get(appConfig.name);

			return factory(appConfig).then((app) => {
				appMap.set(appConfig.name, app);
				return appMap;
			});
		});
	}, Promise.resolve(new Map()));

	return applicationsPromise.then((applications) => {
		const applicationRequestHandler = createApplicationRequestHandler({
			eventBus,
			applications,
		});

		return startServers({
			eventBus,
			logger,
			config,
			applicationRequestHandler,
		});
	});
}
