'use strict';

const StackedError = require(`../classes/stacked-error`);
const {isFunction, deepFreeze} = require(`../../library`);

const DEFAULTS = deepFreeze({
	origin: `*`,
	methods: `GET`,
	headers: `Content-Type`,
	maxAge: 86400
});

module.exports = function crossOriginRequest(options = {}) {
	const {skip, origin, methods, headers, lookup} = options;

	const doLookup = isFunction(lookup);
	const originString = origin || DEFAULTS.origin;
	const methodsString = Array.isArray(methods) ? methods.join(`,`) : DEFAULTS.methods;
	const headersString = Array.isArray(headers) ? headers.join(`,`) : DEFAULTS.headers;
	const maxAge = Number.isInteger(options.maxAge) ? options.maxAge : DEFAULTS.maxAge;

	function setHeaders(req, res, values = {}) {
		const origin = values.origin || originString;

		res.set(`Access-Control-Allow-Origin`, origin);

		if (req.method === `OPTIONS`) {
			res.set(`Access-Control-Allow-Methods`, values.methods || methodsString);
			res.set(`Access-Control-Allow-Headers`, values.headers || headersString);
			res.set(`Access-Control-Max-Age`, values.maxAge || maxAge);
		}

		if (origin !== `*`) {
			res.set(`Vary`, `Origin`);
		}
	}

	return function crossOriginRequestMiddleware(req, res, next) {
		if (skip) return next();

		if (doLookup) {
			return lookup(req, res).then((values) => {
				setHeaders(req, res, values);
				return next();
			}).catch((err) => {
				return next(new StackedError(
					`Error attempting to lookup cross origin request options in crossOriginRequestMiddleware()`,
					err
				));
			});
		}

		setHeaders(req, res);
		return next();
	};
};
