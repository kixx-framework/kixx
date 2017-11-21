'use strict';

const Promise = require(`bluebird`);
const http = require(`http`);
const https = require(`https`);

const bufferHttpServerResponse = require(`./buffer-http-server-response`);

const DEFAULT_TIMEOUT = 10000;

module.exports = function httpSendBuffer(args, data) {
	const {hostname, port, method, headers, path, timeout, encoding} = args;
	const protocol = args.protocol || `https:`;

	const params = {
		protocol,
		hostname,
		port,
		method: method || `POST`,
		path,
		headers,
		timeout: Number.isInteger(timeout) ? timeout : DEFAULT_TIMEOUT
	};

	const NS = protocol === `https:` ? https : http;

	return new Promise((resolve, reject) => {
		const req = NS.request(params, bufferHttpServerResponse(resolve, reject));
		req.once(`error`, reject);
		if (encoding) {
			req.write(data, encoding);
		} else {
			req.write(data);
		}
		req.end();
	});
};
