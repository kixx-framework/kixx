import { JsonParsingError } from 'kixx-server-errors';

export default class WrappedRequest {

	url = null;
	originatingProtocol = null;
	originatingPort = null;
	// Will be set when the URL is matched with a pattern.
	pattern = null;
	params = null;

	#nodeHttpRequest = null;

	constructor(spec) {
		Object.defineProperties(this, {
			url: {
				enumerable: true,
				value: spec.url,
			},
			originatingPort: {
				enumerable: true,
				value: spec.originatingPort,
			},
			originatingProtocol: {
				enumerable: true,
				value: spec.originatingProtocol,
			},
		});

		this.#nodeHttpRequest = spec.nodeHttpRequest;
	}

	get method() {
		return this.#nodeHttpRequest.method;
	}

	get headers() {
		return this.#nodeHttpRequest.headers;
	}

	get host() {
		return this.url.host;
	}

	get origin() {
		return this.url.origin;
	}

	get pathname() {
		return this.url.pathname;
	}

	get canonicalURL() {
		return this.url.href;
	}

	getReadStream() {
		return this.#nodeHttpRequest;
	}

	getHeader(key) {
		return this.#nodeHttpRequest.headers[key.toLowerCase()];
	}

	getBufferedData() {
		return new Promise((resolve, reject) => {
			const req = this.#nodeHttpRequest;

			const data = [];

			function onError(err) {
				reject(err);
			}

			req.once('error', onError);

			req.on('end', function onDataEnd() {
				req.off('error', onError);
				resolve(Buffer.concat(data));
			});

			req.on('data', function onDataChunk(chunk) {
				data.push(chunk);
			});
		});
	}

	async getBufferedJSON() {
		const buff = await this.getBufferedData();
		const utf8Data = buff.toString('utf8');

		// TODO: Safely parse data and catch errors with an appropriately wrapped error
		try {
			return JSON.parse(utf8Data);
		} catch (cause) {
			throw new JsonParsingError('Error parsing HTTP JSON body', { cause });
		}
	}

	toJSON() {
		return {
			method: this.method,
			url: this.url.href,
			headers: this.headers,
		};
	}
}
