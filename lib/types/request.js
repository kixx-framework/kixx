'use strict';

const Promise = require(`bluebird`);
const R = require(`ramda`);
const url = require(`url`);
const zlib = require(`zlib`);
const Boom = require(`boom`);
const contentType = require(`content-type`);
const iconv = require(`iconv-lite`);

class Request {
	constructor(req, spec) {
		spec = spec || {};

		Object.defineProperties(this, {
			req: {
				value: req
			},
			method: {
				enumerable: true,
				value: req.method
			},
			// Url {
			// 	search: '?gordy=name&bob=minion',
			// 	query: 'gordy=name&bob=minion',
			// 	pathname: '/foo/bar',
			// 	path: '/foo/bar?gordy=name&bob=minion',
			// 	href: '/foo/bar?gordy=name&bob=minion'
			// }
			url: {
				enumerable: true,
				value: url.parse(req.url)
			},
			headers: {
				enumerable: true,
				value: R.clone(req.headers)
			},
			params: {
				enumerable: true,
				value: spec.params || Object.create(null)
			},
			body: {
				enumerable: true,
				value: spec.body || null
			},
			payload: {
				enumerable: true,
				value: spec.payload || null
			}
		});
	}

	parseContentType() {
		const str = this.headers[`content-type`];
		if (!str) {
			return null;
		}

		// Content-Type parsing:
		// https://github.com/jshttp/content-type
		try {
			return contentType.parse(str);
		} catch (err) {
			throw Boom.badRequest(`Invalid Content-Type header "${str}"`);
		}
	}

	setParams(params) {
		return new Request(this.req, R.assoc(
			`params`,
			params,
			this
		));
	}

	withStringBody(args) {
		args = args || {};
		const self = this;
		const limit = args.limit || 100 * 1024; // 100kb
		const length = parseInt(this.headers[`content-length`], 10) || null;
		const encoding = (this.headers[`content-encoding`] || `identity`).toLowerCase();
		let decoder = null;

		if (length !== null && length > limit) {
			return Promise.reject(Boom.entityTooLarge());
		}

		const stream = getContentStream(self.req, encoding);

		if (!stream) {
			return Promise.reject(Boom.unsupportedMediaType(
				`Unsupported content encoding "${encoding}"`
			));
		}

		const charset = this.parseContentType().parameters.charset || `utf-8`;

		try {
			decoder = iconv.getDecoder(charset);
		} catch (err) {
			if (err.message.startsWith(`Encoding not recognized`)) {
				return Promise.reject(Boom.unsupportedMediaType(
					`Unsupported content charset ${encoding}`
				));
			}
		}

		return new Promise((resolve, reject) => {
			function afterBuffering(str) {
				resolve(new Request(self.req, R.assoc(
					`body`,
					str,
					self
				)));
			}

			bufferStringBody(
				{decoder, stream, limit},
				afterBuffering,
				reject
			);
		});
	}

	withJsonBody(args) {
		return this.withStringBody(args).then((request) => {
			const {body} = request;

			if (body.length <= 0) {
				return Promise.reject(Boom.badData(
					`JSON request payload is empty`
				));
			}

			if (body.charAt(0) !== `{` && body.charAt(0) !== `[`) {
				return Promise.reject(Boom.badData(
					`JSON request payload must begin with "{" or "["`
				));
			}

			let json;
			try {
				json = JSON.parse(body);
			} catch (err) {
				return Promise.reject(Boom.badData(
					`JSON parsing error in request body: ${err.message}`
				));
			}

			return new Request(request.req, R.assoc(
				`payload`,
				json,
				request
			));
		});
	}
}

module.exports = Request;

function bufferStringBody(args, resolve, reject) {
	const {decoder, stream, limit} = args;
	let received = 0;
	let buffer = ``;
	let complete = false;

	function cleanup() {
		if (complete) {
			return;
		}

		complete = true;

		stream.removeListener(`error`, onError);
		stream.removeListener(`aborted`, onAborted);
		stream.removeListener(`data`, onData);
		stream.removeListener(`close`, onClose);
		stream.removeListener(`end`, onEnd);
	}

	function onError(err) {
		cleanup();
		return reject(err);
	}

	function onAborted() {
		cleanup();
		return reject(Boom.badRequest(`Request aborted`));
	}

	function onData(chunk) {
		received += chunk.length;

		if (received > limit) {
			cleanup();
			return reject(Boom.entityTooLarge());
		}

		buffer += decoder.write(chunk);
	}

	function onClose() {
		cleanup();
	}

	function onEnd() {
		if (received > limit) {
			cleanup();
			return reject(Boom.entityTooLarge());
		}

		buffer += decoder.end() || ``;
		cleanup();
		return resolve(buffer);
	}

	stream.on(`error`, onError);
	stream.on(`aborted`, onAborted);
	stream.on(`data`, onData);
	stream.on(`close`, onClose);
	stream.on(`end`, onEnd);
}

function getContentStream(rawRequest, encoding) {
	// Specific to content encoding:
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding
	let stream = null;

	switch (encoding) {
		case `deflate`:
			stream = zlib.createInflate();
			rawRequest.pipe(stream);
			return stream;
		case `gzip`:
			stream = zlib.createGunzip();
			rawRequest.pipe(stream);
			return stream;
		case `identity`:
			stream = rawRequest;
			return stream;
		default:
			return stream;
	}
}
