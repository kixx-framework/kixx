'use strict';

const Promise = require(`bluebird`);
const http = require(`http`);
const https = require(`https`);

const bufferHttpServerResponse = require(`./buffer-http-server-response`);

const DEFAULT_TIMEOUT = 10000;

module.exports = function httpFetchBuffer(args) {
	const {hostname, port, method, headers, path, timeout} = args;
	const protocol = args.protocol || `https:`;

	const params = {
		protocol,
		hostname,
		port,
		method: method || `GET`,
		path,
		headers,
		timeout: Number.isInteger(timeout) ? timeout : DEFAULT_TIMEOUT
	};

	const NS = protocol === `https:` ? https : http;

	return new Promise((resolve, reject) => {
		const req = NS.request(params, bufferHttpServerResponse(resolve, reject));
		req.once(`error`, reject);
		req.end();
	});
};
