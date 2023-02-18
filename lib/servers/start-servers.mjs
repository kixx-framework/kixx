import path from 'node:path';
import { ErrorEvent } from '../events.mjs';
import createRequestHandler from './create-request-handler.mjs';
import createUnencryptedServer from './create-unencrypted-server.mjs';
import createTLSServer from './create-tls-server.mjs';

export default function startServers(params) {
	const {
		eventBus,
		logger,
		config,
		applicationRequestHandler,
	} = params;

	const servers = [];

	const startServer = (serverConfig) => {
		const requestHandler = createRequestHandler({
			serverConfig,
			config,
			eventBus,
			logger,
			requestHandler: applicationRequestHandler,
		});

		const args = {
			config,
			logger,
			eventBus,
		};

		return createServer(args, requestHandler, serverConfig);
	};

	eventBus.on(ErrorEvent.NAME, (event) => {
		if (event && event.fatal) {
			logger.fatal('fatal error event detected; closing servers');
			// Give a full turn of the event loop for the error event to propagate
			// before closing the servers.
			setTimeout(() => {
				closeServers(servers);
			}, 0);
		}
	});

	// Start the servers serially (using reduce()) instead of in parallel (using map()). Starting
	// in serial allows us to shut them down if one fails to start.
	const allDonePromise = config.servers.reduce((promise, serverConfig) => {
		return promise.then(() => {
			return startServer(serverConfig).then((server) => {
				servers.push(server);
				return server;
			});
		});
	}, Promise.resolve(null));

	return allDonePromise.catch((cause) => {
		if (servers.length > 0) {
			logger.info('error detected while starting servers; closing servers');
		}

		closeServers(servers);
		return Promise.reject(cause);
	});
}

function createServer(params, requestHandler, serverConfig) {
	const {
		logger,
		eventBus,
		config,
	} = params;

	const { port, encrypted } = serverConfig;

	if (encrypted) {
		logger.info('starting tls server', { port });

		// The certificate directory is resolved from the current working directory.
		const sslCertificateDirectory = path.resolve(config.ssl_certificate_directory);

		return createTLSServer({
			eventBus,
			logger,
			port,
			applications: config.applications,
			sslCertificateDirectory,
		}, requestHandler);
	}

	logger.info('starting unencrypted server', { port });

	return createUnencryptedServer({
		eventBus,
		logger,
		port,
	}, requestHandler);
}

function closeServers(servers) {
	servers.forEach((server) => {
		server.close();
	});
}
