import http from 'node:http';
import { OperationalError } from 'kixx-server-errors';
import { ErrorEvent, InfoEvent } from '../events.mjs';

export default function createUnencryptedServer(params, requestHandler) {
	const {
		eventBus,
		logger,
		port,
	} = params;

	return new Promise(function startUnencryptedServerPromise(resolve, reject) {
		let resolved = false;
		const server = http.createServer();

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

		server.on('error', (cause) => {
			logger.error('error event from the unencrypted server', { port, cause });

			const error = new OperationalError('Server error event', {
				cause,
				fatal: true,
				code: 'SERVER_ERROR_EVENT',
				info: { port, encrypted: false },
			});

			emitError(error);
		});

		server.on('listening', () => {
			logger.info('unencrypted server listening', { port });

			eventBus.emit(new InfoEvent({
				type: 'SERVER_START',
				message: `server listening on port ${ port }`,
				info: { port, encrypted: false },
			}));

			resolvePromise();
		});

		server.on('request', requestHandler);

		server.listen(port);
	});
}
