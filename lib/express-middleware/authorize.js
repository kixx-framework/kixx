'use strict';

const UnauthorizedError = require(`../classes/unauthorized-error`);
const ForbiddenError = require(`../classes/forbidden-error`);

const {isFunction, append, intersection} = require(`../../library`);

const DEFAULT_ENTITLEMENTS = Object.freeze([]);

function getDefaultEntitlements() {
	return DEFAULT_ENTITLEMENTS;
}

module.exports = function authorize(options = {}) {
	const allowUnauthenticated = Boolean(options.allowUnauthenticated);
	const getEntitlements = isFunction(options.getEntitlements) ? options.getEntitlements : getDefaultEntitlements;

	const unauthorizedHeaders = {
		'WWW-Authenticate': `Bearer`
	};

	return function authorizeMiddleware(req, res, next) {
		if (allowUnauthenticated) {
			return next();
		}

		let entitlements = getEntitlements(req);

		if (!entitlements || entitlements.length === 0) {
			return next();
		}

		if (!req.user) {
			return next(new UnauthorizedError(
				`An authenticated user is required to access ${req.method} ${req.originalUrl}`,
				{headers: unauthorizedHeaders}
			));
		}

		entitlements = append(`superadmin`, entitlements);

		const userEntitlements = Array.isArray(req.user.meta.entitlements) ? req.user.meta.entitlements : [];

		if (intersection(entitlements, userEntitlements).length === 0) {
			return next(new ForbiddenError(
				`Access denied for ${req.method} ${req.originalUrl}`
			));
		}

		next();
	};
};
