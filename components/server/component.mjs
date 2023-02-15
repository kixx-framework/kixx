import BaseComponent from '../../lib/base-component';
import { ErrorEvent } from '../../lib/events';
import { start as startUnencryptedServer } from './unencrypted-server';
import { start as startTLSServer } from './tls-server';
import { create as createRequestHandler } from './request-handler';

export default class Server extends BaseComponent {

	#configManager = null;
	#logger = null;
	#nativeNetServers = [];
	#applicationRequestHandler = null;

	static listDependencies() {
		return [
			'configManager',
			'logger',
			'applicationRequestHandler',
		];
	}

	constructor() {
		super();

		Object.defineProperties(this, {
			onErrorEvent: {
				enumerable: false,
				value: this.onErrorEvent.bind(this),
			},
			closeServers: {
				enumerable: false,
				value: this.closeServers.bind(this),
			},
		});
	}

	injectDependencies(deps) {
		this.#configManager = deps.get('configManager');
		this.#logger = deps.get('logger').getRootLogger();
		this.#applicationRequestHandler = deps.get('requestHandler');
	}

	initialize(context) {
		const { eventBus } = context;

		eventBus.on(ErrorEvent.NAME, this.onErrorEvent);

		const servers = this.#configManager.getServers();

		const promises = servers.map((serverConfig) => {

			const { port, secure } = serverConfig;
			const protocol = secure ? 'https' : 'http';

			const requestHandler = createRequestHandler({
				configManager: this.#configManager,
				eventBus,
				logger: this.#logger,
				port,
				protocol,
				requestHandler: this.#applicationRequestHandler.handleRequest,
			});

			if (secure) {
				this.#logger.info(`starting tls server on port ${ port }`);

				return startTLSServer({
					configManager: this.#configManager,
					eventBus,
					logger: this.#logger,
					port,
				}, requestHandler);
			}

			this.#logger.info(`starting unencrypted server on port ${ port }`);

			return startUnencryptedServer({
				configManager: this.#configManager,
				eventBus,
				logger: this.#logger,
				port,
			}, requestHandler);
		});

		return Promise.all(promises).then((nativeNetServers) => {
			// Capture the native node.js Server instances so we can have a reference to them when
			// needed; ex: for shutting down the system we close each server.
			nativeNetServers.forEach((server) => {
				this.#nativeNetServers.push(server);
			});

			Object.freeze(this.#nativeNetServers);

			return true;
		});
	}

	onErrorEvent(event) {
		if (event && event.fatal) {
			// Shut down the servers in the next turn of the event loop.
			setTimeout(this.closeServers, 0);
		}
	}

	closeServers() {
		this.#nativeNetServers.forEach(function shutDownServer(server) {
			server.close();
		});
	}
}
