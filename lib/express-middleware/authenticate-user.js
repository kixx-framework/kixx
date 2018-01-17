'use strict';

const StackedError = require(`../classes/stacked-error`);
const ProgrammerError = require(`../classes/programmer-error`);
const UnauthorizedError = require(`../classes/unauthorized-error`);

const JWT = require(`jsonwebtoken`);

const {isNonEmptyString, isBoolean, isFunction, deepFreeze} = require(`../../library`);

module.exports = function authenticateUser(options = {}) {
	const {store, secret, audience, issuer} = options;
	const type = isNonEmptyString(options.type) ? options.type : `user`;
	const ignoreExpiration = isBoolean(options.ignoreExpiration) ? options.ignoreExpiration : true;
	const allowUnauthenticated = Boolean(options.allowUnauthenticated);
	const getToken = isFunction(options.getToken) ? options.getToken : parseAuthHeader;

	if (!isNonEmptyString(secret)) {
		throw new ProgrammerError(
			`The options.secret String is required in the authenticateUser() middleware factory.`
		);
	}

	const unauthorizedHeaders = {
		'WWW-Authenticate': `Bearer`
	};

	return function authenticateUserMiddleware(req, res, next) {
		const {transaction} = req;
		const options = {};

		if (ignoreExpiration) {
			options.ignoreExpiration = true;
		}
		if (audience) {
			options.audience = audience;
		}
		if (issuer) {
			options.issuer = issuer;
		}

		const token = getToken(req);
		if (!token) {
			if (allowUnauthenticated) {
				req.user = null;
				return next();
			}
			return next(new UnauthorizedError(
				`Missing JSON Web Token`,
				{headers: unauthorizedHeaders}
			));
		}

		JWT.verify(token, secret, options, (err, decodedToken) => {
			if (err) {
				if (err.name === `TokenExpiredError` || err.name === `JsonWebTokenError`) {
					return next(new UnauthorizedError(
						err.message,
						{headers: unauthorizedHeaders}
					));
				}
				return next(new StackedError(
					`JWT verification error in authenticateUserMiddleware()`,
					err
				));
			}

			const userId = decodedToken.sub;
			if (!isNonEmptyString(userId)) {
				return next(new UnauthorizedError(
					`JSON Web Token 'sub' claim is not a valid string`,
					{headers: unauthorizedHeaders}
				));
			}

			const args = {
				type,
				id: userId
			};

			return store.get(transaction, args).then((result) => {
				const {response} = result;
				if (!response.data) {
					if (allowUnauthenticated) {
						req.user = null;
						return next();
					}
					return next(new UnauthorizedError(
						`Unable to find user record '${userId}'`,
						{headers: unauthorizedHeaders}
					));
				}

				req.user = deepFreeze(response.data);
				next();
				return null;
			}).catch((err) => {
				return next(new StackedError(
					`Error attempting to fetch user in authenticateUserMiddleware()`,
					err
				));
			});
		});
	};
};

function parseAuthHeader(req) {
	const str = req.get(`Authorization`);
	if (!isNonEmptyString(str)) return null;
	return str.replace(/^Bearer[\s]+/, ``);
}
