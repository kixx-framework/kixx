import { helpers } from 'kixx-assert';
import Configurations from './configurations.mjs';

const DEFAULT_PORTS = [ 80, 443 ];

// The "^" symbol within "[^]" means one NOT of the following set of characters.
// eslint-disable-next-line no-useless-escape
const DISALLOWED_URL_CHARACTERS = /[^a-z0-9_\.\-\/\?\=%]/i;

export default function createRequestHandler(params) {
	const {
		serverConfig,
		config,
		logger,
		requestHandler,
	} = params;

	function getOriginatingPort() {
		// TODO: Use the X-Forwarded-Port header value
		return serverConfig.port;
	}

	function getOriginatingProtocol() {
		// TODO: Use the X-Forwarded-Proto header value
		return serverConfig.encrypted ? 'https' : 'http';
	}

	function getHostname(req) {
		// TODO: Use the X-Forwarded-For header value
		const hostString = req.headers.host || '';
		return hostString.split(':')[0] || null;
	}

	return function handleRequest(req, res) {
		const originatingPort = getOriginatingPort(req);
		const originatingProtocol = getOriginatingProtocol(req);
		const hostname = getHostname(req);
		const { method } = req;

		const href = `${ hostname }:${ originatingPort }${ req.url }`;

		logger.debug('request', { method, href });

		if (!helpers.isNonEmptyString(hostname)) {
			logger.debug('invalid request host', { host: hostname });
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
			if (!DEFAULT_PORTS.includes(originatingPort)) {
				host = `${ hostname }:${ originatingPort }`;
			}

			// Parse the URL.
			url = new URL(req.url, `${ originatingProtocol }://${ host }`);
		} catch (cause) {
			logger.debug('invalid request url', { url: req.url, cause });
			sendInvalidUrlResponse(req, res);
			return;
		}

		const appConfig = Configurations.findHostApplication(config.applications, hostname, originatingPort);

		if (!appConfig) {
			logger.debug('host not available', { host: hostname });
			sendNotFoundHostResponse(req, res);
			return;
		}

		const preferredHost = Configurations.getPreferredHost(appConfig);
		const preferredPort = Configurations.getPreferredPort(appConfig);
		const preferredProtocol = appConfig.preferEncrypted ? 'https' : 'http';

		const usePreferredHost = preferredHost && preferredHost !== hostname;
		const usePreferredPort = preferredPort && preferredPort !== originatingPort;

		let newLocation = null;

		if (usePreferredHost && usePreferredPort) {
			// Redirect to the preferred host and port:
			newLocation = composeRedirectLocation(
				preferredProtocol,
				preferredHost,
				req.url,
				preferredPort
			);
		} else if (usePreferredHost) {
			newLocation = composeRedirectLocation(
				preferredProtocol,
				preferredHost,
				req.url,
				originatingPort
			);
		} else if (usePreferredPort) {
			newLocation = composeRedirectLocation(
				preferredProtocol,
				hostname,
				req.url,
				preferredPort
			);
		}

		if (newLocation) {
			logger.debug('301 redirection', { location: newLocation });
			send301Redirect(req, res, newLocation);
			return;
		}

		const requestDetails = {
			appConfig,
			url,
			originatingPort,
			originatingProtocol,
		};

		requestHandler(requestDetails, req, res);
	};
}

function sendInvalidHostResponse(req, res) {
	const body = 'Bad Request: Invalid host request header\n';

	res.writeHead(400, 'Bad Request', {
		'content-type': 'text/plain; charset=UTF-8',
		'content-length': Buffer.byteLength(body),
	});

	res.end(body);
}

function sendInvalidUrlResponse(req, res) {
	const body = 'Bad Request: Invalid URL\n';

	res.writeHead(400, 'Bad Request', {
		'content-type': 'text/plain; charset=UTF-8',
		'content-length': Buffer.byteLength(body),
	});

	res.end(body);
}

function sendNotFoundHostResponse(req, res) {
	const body = 'Not Found: Host not found\n';

	res.writeHead(404, 'Not Found', {
		'content-type': 'text/plain; charset=UTF-8',
		'content-length': Buffer.byteLength(body),
	});

	res.end(body);
}

function send301Redirect(req, res, location) {
	res.writeHead(301, 'Moved Permanently', { location });
	res.end();
}

function composeRedirectLocation(protocol, hostname, url, port) {
	if (DEFAULT_PORTS.includes(port)) {
		return `${ protocol }://${ hostname }${ url }`;
	}

	return `${ protocol }://${ hostname }:${ port }${ url }`;
}
