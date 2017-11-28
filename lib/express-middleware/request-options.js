'use strict';

module.exports = function requestOptions(options = {}) {
	const methods = Array.isArray(options.methods) ? Object.freeze(options.methods.slice()) : [];
	const allow = methods.join(`,`);

	return function requestOptionsMiddleware(req, res, next) {
		if (req.method !== `OPTIONS`) {
			return next();
		}

		res
			.set(`Allow`, allow)
			.sendStatus(200);
	};
};

