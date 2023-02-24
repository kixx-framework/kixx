import { JsonParsingError } from 'kixx-server-errors';

export default class WrappedRequest {

	url = null;
	originatingProtocol = null;
	originatingPort = null;
	// Will be set when the URL is matched with a pattern.
	pattern = null;
	params = null;

	#appConfig = null;
	#nativeRequest = null;

	constructor(spec) {
		this.url = spec.url;
		this.originatingPort = spec.originatingPort;
		this.originatingProtocol = spec.originatingProtocol;

		this.#appConfig = spec.appConfig;
		this.#nativeRequest = spec.nativeRequest;
	}

	get method() {
		return this.#nativeRequest.method;
	}

	get headers() {
		return this.nativeRequest.headers;
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

	get pathnameParams() {
		return this.params;
	}

	get canonicalURL() {
		return this.url.href;
	}

	get appName() {
		return this.#appConfig.name;
	}

	getReadStream() {
		return this.#nativeRequest;
	}

	getHeader(key) {
		return this.#nativeRequest.headers[key.toLowerCase()];
	}

	getBufferedData() {
		return new Promise((resolve, reject) => {
			const req = this.#nativeRequest;

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
