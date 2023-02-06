import { OperationalError } from 'kixx-server-errors';
import { helpers } from 'kixx-assert';
import { ErrorEvent, DebugEvent } from '../../lib/events';

import {
	sendInvalidHostResponse,
	sendInvalidUrlResponse,
	sendNotFoundHostResponse,
	send301Redirect,
	sendServerError
} from './server-utilities';

const { isNonEmptyString } = helpers;

// The "^" symbol within "[^]" means one NOT of the following set of characters.
// eslint-disable-next-line no-useless-escape
const DISALLOWED_URL_CHARACTERS = /[^a-z0-9_\.\-\/\?\=%]/i;


/**
 * @param {ConfigManager} options.configManager
 * @param {EventBus} options.eventBus
 * @param {Logger} options.logger
 * @param {Number} options.port
 * @param {String} options.protocol
 * @param {Function} requestHandler
 */
export function create(options, requestHandler) {
	const {
		configManager,
		eventBus,
		logger,
		port,
		protocol,
	} = options;

	function getOriginatingPort() {
		// TODO: Use the X-Forwarded-Port header value
		return port;
	}

	function getOriginatingProtocol() {
		// TODO: Use the X-Forwarded-Proto header value
		return protocol;
	}

	function getHostname(req) {
		// TODO: Use the X-Forwarded-For header value
		const hostString = req.headers.host || '';
		return hostString.split(':')[0] || null;
	}

	function handleRequest(req, res) {
		const defaultServerName = configManager.getDefaultServerName();
		const originatingPort = getOriginatingPort(req);
		const originatingProtocol = getOriginatingProtocol(req);
		const hostname = getHostname(req);

		const href = `${ hostname }:${ port }${ req.url }`;

		eventBus.emit(new DebugEvent({
			type: 'SERVER_REQUEST',
			message: `${ req.method } ${ href }`,
			info: { port, method: req.method, href },
		}));

		if (!isNonEmptyString(hostname)) {
			logger.info('invalid request host', { port, method: req.method, href, host: hostname });

			eventBus.emit(new DebugEvent({
				type: 'INVALID_REQUEST_HOST',
				message: 'invalid request host',
				info: { port, method: req.method, href, host: hostname },
			}));

			if (defaultServerName) {
				res.setHeader('server', defaultServerName);
			}

			sendInvalidHostResponse(req, res);
			return;
		}

		let url;

		try {
			decodeURIComponent(req.url);

			if (DISALLOWED_URL_CHARACTERS.test(req.url)) {
				throw new TypeError('Disallowed characters in request URL');
			}

			let host = hostname;

			// If the external port is NOT the default 80 or 443 then we need to include it in the URL string.
			if (originatingPort !== 443 && originatingPort !== 80) {
				host = `${ hostname }:${ originatingPort }`;
			}

			// Parse the URL.
			url = new URL(req.url, `${ originatingProtocol }://${ host }`);
		} catch (cause) {
			logger.info('invalid request pathname', { port, method: req.method, href, pathname: req.url });

			eventBus.emit(new DebugEvent({
				type: 'INVALID_REQUEST_PATHNAME',
				message: 'invalid request pathname',
				info: { port, method: req.method, href, pathname: req.url },
				cause,
			}));

			if (defaultServerName) {
				res.setHeader('server', defaultServerName);
			}

			sendInvalidUrlResponse(req, res);
			return;
		}

		const virtualHost = configManager.getVirtualHostConfigByHostname(hostname);

		if (!virtualHost) {
			logger.debug('host not found', { port, method: req.method, href, host: hostname });

			eventBus.emit(new DebugEvent({
				type: 'HOST_NOT_FOUND',
				message: 'host not found',
				info: { port, method: req.method, href, host: hostname },
			}));

			if (defaultServerName) {
				res.setHeader('server', defaultServerName);
			}

			sendNotFoundHostResponse(req, res);
			return;
		}

		const serverName = virtualHost.getServerName();

		if (serverName) {
			res.setHeader('server', serverName);
		} else if (defaultServerName) {
			res.setHeader('server', defaultServerName);
		}

		const preferredHost = virtualHost.getPreferredHost();

		// Most servers will redirect http: to https in a production environment:
		if (url.hostname !== preferredHost.hostname || originatingPort !== preferredHost.port) {
			// Redirect to the preferred host. If the port is the default 443 or 80 then we don't need
			// to include it in the URL string.
			const newLocation = (preferredHost.port === 443 || preferredHost.port === 80)
				? `${ preferredHost.protocol }://${ preferredHost.hostname }${ req.url }`
				: `${ preferredHost.protocol }://${ preferredHost.hostname }:${ preferredHost.port }${ req.url }`;

			logger.debug('forcing 301 redirect', { port, method: req.method, href, location: newLocation });

			eventBus.emit(new DebugEvent({
				type: '301_REDIRECT',
				message: 'host not found',
				info: { port, method: req.method, href, location: newLocation },
			}));

			send301Redirect(req, res, newLocation);
			return;
		}

		logger.debug(`${ req.method } ${ href }`);

		try {
			requestHandler(req, res, {
				virtualHost,
				url,
				originatingPort,
				originatingProtocol,
			});
		} catch (cause) {
			logger.error('error event in top level request handler', {
				port,
				method: req.method,
				href,
				cause,
			});

			const error = new OperationalError('Unexpected server error', {
				cause,
				fatal: true,
				code: 'REQUEST_HANDLER_ERROR',
				info: {
					port,
					method: req.method,
					href,
				},
			});

			sendServerError(req, res);

			eventBus.emit(new ErrorEvent(error));
		}
	}

	return handleRequest;
}
