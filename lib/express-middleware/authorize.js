'use strict';

const UnauthorizedError = require(`../classes/unauthorized-error`);

const {isFunction} = require(`../../library`);

const DEFAULT_ENTITLEMENTS = [`superadmin`];

function getDefaultEntitlements() {
	return DEFAULT_ENTITLEMENTS;
}

module.exports = function authorize(options = {}) {
	const getEntitlements = isFunction(options.getEntitlements) ? options.getEntitlements : getDefaultEntitlements;

	const unauthorizedHeaders = {
		'WWW-Authenticate': `Bearer`
	};

	return function authorizeMiddleware(req, res, next) {
		const entitlements = getEntitlements(req);

		if (!entitlements || entitlements.length === 0) {
			return next();
		}

		if (!req.user) {
			return next(new UnauthorizedError(
				`An authenticated user is required to access ${req.method} ${req.originalUrl}`,
				{headers: unauthorizedHeaders}
			));
		}

		next();
	};
};
