'use strict';

const R = require(`ramda`);

class Response {
	constructor(res, spec) {
		spec = spec || {};

		Object.defineProperties(this, {
			res: {
				value: res
			},
			status: {
				enumerable: true,
				value: spec.status || 200
			},
			data: {
				enumerable: true,
				value: spec.data || null
			}
		});
	}

	setData(obj) {
		return new Response(this.res, R.assoc(
			`data`,
			obj,
			this
		));
	}

	setHeader(name, value) {
		if (this.res._headerSent) {
			throw new Error(
				`Headers have already been sent for this response.`
			);
		}
		this.res.setHeader(name, value);
		return this;
	}

	setStatus(status) {
		return new Response(this.res, R.assoc(
			`status`,
			status,
			this
		));
	}

	writeHead() {
		if (this.res._headerSent) {
			throw new Error(
				`Headers have already been sent for this response.`
			);
		}
		this.res.writeHead(this.status);
		return this;
	}

	write(chunk) {
		if (this.res.finished) {
			throw new Error(`Cannot write to a finished response.`);
		}
		this.res.write(chunk);
		return this;
	}

	sendHTML(str) {
		return this
			.setHeader(`content-type`, `text/html; charset=UTF-8`)
			.writeHead()
			.write(str)
			.end();
	}

	sendJSON(obj) {
		const str = JSON.stringify(obj);

		return this
			.setHeader(`content-type`, `application/json; charset=UTF-8`)
			.writeHead()
			.write(str)
			.end();
	}

	end() {
		this.res.end();
		return this;
	}
}

module.exports = Response;
