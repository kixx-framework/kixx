'use strict';

const url = require(`url`);
const Promise = require(`bluebird`);

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
				value: Object.assign(Object.create(null), req.headers)
			},
			params: {
				enumerable: true,
				value: spec.params || Object.create(null)
			},
			body: {
				enumerable: true,
				value: spec.body || null
			}
		});
	}

	setParams(params) {
		return new Request(
			this.req,
			Object.assign({}, this, {params})
		);
	}

	withBody() {
		const self = this;
		let body = ``;

		self.req.on(`data`, (chunk) => {
			body += chunk;
		});

		return new Promise((resolve, reject) => {
			self.req.on(`error`, reject);

			self.req.on(`end`, () => {
				resolve(new Request(
					self.req,
					Object.assign({}, self, {body})
				));
			});
		});
	}

	static create(req) {
		return new Request(req);
	}
}

module.exports = Request;
