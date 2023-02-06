import path from 'node:path';
import fs from 'node:fs';
import tls from 'node:tls';
import https from 'node:https';
import { OperationalError, ProgrammerError } from 'kixx-server-errors';
import { ErrorEvent, InfoEvent } from '../../lib/events';

/**
 * @param {ConfigManager} options.configManager
 * @param {EventBus} options.eventBus
 * @param {Logger} options.logger
 * @param {Number} options.port
 * @param {Function} requestHandler
 */
export default function start(options, requestHandler) {
	const {
		configManager,
		eventBus,
		logger,
		port,
	} = options;

	const sslCertMap = new Map();
	const sslKeyMap = new Map();
	const hostnameMap = new Map();

	function loadSSLCertificates() {
		const sourceDirectory = configManager.getSSLCertificateDirectory();
		const directoryStat = fs.statSync(sourceDirectory, { throwIfNoEntry: false });

		if (!directoryStat) {
			throw new ProgrammerError(`SSL certificate source directory not present: ${ sourceDirectory }`);
		}

		if (!directoryStat.isDirectory()) {
			throw new ProgrammerError(`SSL certificate source is not a directory: ${ sourceDirectory }`);
		}

		// Iterate through the configuration for each virtual host.
		configManager.getVirtualHosts().forEach((virtualHost) => {
			const virtualHostPorts = virtualHost.getPorts();

			// If this virtual host is configured to listen on specific ports which this server
			// is not listening to then we don't need to load the certificates.
			if (virtualHostPorts.length > 0 && !virtualHostPorts.includes(port)) {
				return;
			}

			virtualHost.getHostnames().forEach(({ hostname, ssl }) => {
				// Hostnames may share the same SSL cert. ex: "www.example.com" and "example.com".
				if (!sslCertMap.has(ssl)) {
					sslCertMap.set(ssl, loadSSLCertificateFile(sourceDirectory, ssl));
					sslKeyMap.set(ssl, loadSSLKeyFile(sourceDirectory, ssl));
				}
				// Map the hostname to the SSL certificate name.
				hostnameMap.set(hostname, ssl);
			});
		});
	}

	function loadSSLCertificateFile(directory, name) {
		const filename = path.join(directory, `${ name }.cert`);
		try {
			return fs.readFileSync(filename);
		} catch (cause) {
			return new ProgrammerError(`SSL certificate file not present: ${ filename }`, { cause });
		}
	}

	function loadSSLKeyFile(directory, name) {
		const filename = path.join(directory, `${ name }.key`);
		try {
			return fs.readFileSync(filename);
		} catch (cause) {
			throw new ProgrammerError(`SSL key file unreadable: ${ filename }`, { cause });
		}
	}

	return new Promise(function startTLSServerPromise(resolve, reject) {
		try {
			loadSSLCertificates();
		} catch (cause) {
			reject(new OperationalError('Error while loading SSL certificate data', {
				cause,
				fatal: true,
				code: 'SSL_CERT_LOAD_ERROR',
			}));
			return;
		}

		let resolved = false;
		const server = https.createServer({ SNICallback: sniCallback });

		function emitError(error) {
			if (resolved) {
				eventBus.emit(new ErrorEvent(error));
			} else {
				resolved = true;
				reject(error);
			}
		}

		function resolvePromise() {
			if (!resolved) {
				resolved = true;
				resolve(server);
			}
		}

		function sniCallback(servername, callback) {
			let ctx;

			try {
				// In a Server Name Indication scheme (SNI) the servername is the hostname on the request.
				const certName = hostnameMap.get(servername);

				ctx = tls.createSecureContext({
					cert: sslCertMap.get(certName),
					key: sslKeyMap.get(certName),
				});
			} catch (cause) {
				logger.error('sni callback unable to create secure context', { port, servername, cause });

				const error = new OperationalError('Unable to create TLS Secure Context', {
					cause,
					fatal: true,
					code: 'TLS_SECURE_CONTEXT_ERROR',
					info: { port, servername },
				});

				emitError(error);
				callback(error);
				return;
			}

			callback(null, ctx);
		}

		server.on('error', (cause) => {
			logger.error('error event from the tls server', { port, cause });

			const error = new OperationalError('Server error event', {
				cause,
				fatal: true,
				code: 'SERVER_ERROR_EVENT',
				info: { port },
			});

			emitError(error);
		});

		server.on('listening', () => {
			logger.info('tls server listening', { port });

			eventBus.emit(new InfoEvent({
				type: 'SERVER_START',
				message: `server listening on port ${ port }`,
				info: { port },
			}));

			resolvePromise();
		});

		server.on('request', requestHandler);

		server.listen(port);
	});
}
