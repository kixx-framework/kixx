import { helpers } from 'kixx-assert';

export default class WrappedResponse {

	#nodeHttpResponse = null;
	#request = null;

	constructor(spec) {
		this.#nodeHttpResponse = spec.nodeHttpResponse;
		this.#request = spec.request;
	}

	areHeadersSent() {
		return Boolean(this.#nodeHttpResponse.headersSent);
	}

	getWriteStream() {
		return this.#nodeHttpResponse;
	}

	setHeader(name, value) {
		this.#nodeHttpResponse.setHeader(name, value);
		return this;
	}

	setStatusCode(statusCode) {
		this.#nodeHttpResponse.statusCode = statusCode;
		return this;
	}

	writeHead(statusCode, headers, data) {
		if (!this.areHeadersSent()) {
			const { method } = this.#request;

			const contentLength = this.#getContentLength(data);

			if (method === 'OPTIONS' && contentLength === 0) {
				statusCode = 204;
			}

			headers = Object.assign({}, headers, { 'conent-length': contentLength });

			this.#nodeHttpResponse.writeHead(statusCode, headers);
		}

		return this;
	}

	writeBody(data) {
		const { method } = this.#request;

		const contentLength = this.#getContentLength(data);

		if (contentLength > 0 && method !== 'HEAD') {
			this.#nodeHttpResponse.write(data);
		}

		this.#nodeHttpResponse.end();

		return this;
	}

	writeText(statusCode, message) {
		const headers = { 'content-type': 'text/plain' };
		return this.writeHead(statusCode, headers, message).writeBody(message);
	}

	writeHTML(statusCode, data) {
		const headers = { 'content-type': 'text/html' };
		return this.writeHead(statusCode, headers, data).writeBody(data);
	}

	writeJSON(statusCode, obj) {
		// TODO: Implement safe JSON stringification
		//       https://github.com/kixxauth/kixx-logger/blob/main/lib/json-stringify.js
		const data = JSON.stringify(obj);
		const headers = { 'content-type': 'application/json' };
		return this.writeHead(statusCode, headers, data).writeBody(data);
	}

	end() {
		this.#nodeHttpResponse.end();
		return this;
	}

	#getContentLength(data) {
		if (helpers.isNonEmptyString(data)) {
			return Buffer.byteLength(data);
		}

		if (data && data.length) {
			// Assume a Buffer
			return data.length;
		}

		return 0;
	}
}
