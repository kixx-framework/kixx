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
		const args = {
			logger,
			eventBus,
			config,
			applicationRequestHandler,
		};

		return createServer(args, serverConfig);
	};

	eventBus.on(ErrorEvent.NAME, (event) => {
		if (event && event.fatal) {
			logger.info('fatal error event detected; closing servers');
			// Give a full turn of the event loop for the error event to propagate
			// before closing the servers.
			setTimeout(() => {
				closeServers(servers);
			}, 0);
		}
	});

	// Start the servers serially (using reduce()) instead of in parallel (using map()).
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

function createServer(params, serverConfig) {
	const {
		logger,
		eventBus,
		config,
		applicationRequestHandler,
	} = params;

	const { port, encrypted } = serverConfig;
	const protocol = encrypted ? 'https' : 'http';

	const requestHandler = createRequestHandler({
		eventBus,
		logger,
		port,
		protocol,
		requestHandler: applicationRequestHandler,
	});

	if (encrypted) {
		logger.info('starting tls server', { port });

		// The certificate directory is resolved from the current working directory.
		const sslCertificateDirectory = path.resolve(config.ssl_certificate_directory);
		console.log(sslCertificateDirectory);

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
