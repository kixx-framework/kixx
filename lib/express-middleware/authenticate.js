'use strict';

const Promise = require('bluebird');
const StackedError = require('../classes/stacked-error');
const ProgrammerError = require('../classes/programmer-error');
const UnauthorizedError = require('../classes/unauthorized-error');

const JWT = require('jsonwebtoken');

const {complement, isFunction, isNonEmptyString} = require('../../library');

const UNAUTHORZED_HEADERS = {
	'WWW-Authenticate': 'Bearer'
};

const isNotFunction = complement(isFunction);

// options.allowUnauthenticated
// options.allowWithoutScope
// options.secret
// options.audience
// options.issuer
// options.redirect
// options.isGlobal
// options.loadUser
// options.loadScope
// options.getToken
// options.getScopeId
// options.headers
module.exports = function authenticate(options = {}) {
	const {secret, audience, issuer, loadScope, loadUser} = options;

	const allowUnauthenticated = Boolean(options.allowUnauthenticated);
	const isGlobal = Boolean(options.isGlobal);
	const allowWithoutScope = Boolean(options.allowWithoutScope);

	if (!isNonEmptyString(secret)) {
		throw new ProgrammerError(
			`authenticate middleware requires options.secret String`
		);
	}

	if (isNotFunction(loadUser) && !allowUnauthenticated) {
		throw new ProgrammerError(
			`authenticate middleware requires options.loadUser() Function`
		);
	}

	if (isNotFunction(loadScope) && !isGlobal && !allowWithoutScope) {
		throw new ProgrammerError(
			`authenticate middleware requires options.loadScope() Function`
		);
	}

	const redirect = isFunction(options.redirect) ? options.redirect : false;
	const getToken = isFunction(options.getToken) ? options.getToken : defaultGetToken;
	const getScopeId = isFunction(options.getScopeId) ? options.getScopeId : defaultGetScopeId;

	const verificationOptions = {
		ignoreExpiration: Boolean(options.ignoreExpiration)
	};

	if (audience) {
		verificationOptions.audience = audience;
	}
	if (issuer) {
		verificationOptions.issuer = issuer;
	}

	const headers = Object.assign({}, UNAUTHORZED_HEADERS, options.headers);

	return function authenticateMiddleware(req, res, next) {
		const token = getToken(req);
		const scopeId = getScopeId(req);

		const tryGetScope = () => {
			return loadScope(req, res, scopeId);
		};

		const tryGetUser = () => {
			return decodeToken(verificationOptions, headers, secret, token).then((decodedToken) => {
				return options.loadUser(req, res, scopeId, decodedToken);
			});
		};

		const promises = [];

		if (token && !allowUnauthenticated) {
			promises.push(tryGetUser());
		} else if (allowUnauthenticated) {
			promises.push(null);
		} else if (redirect) {
			redirect(req, res, next);
			return null;
		} else {
			return next(new UnauthorizedError(
				`Missing JSON Web Token`,
				{headers}
			));
		}

		if (scopeId && !isGlobal && !allowWithoutScope) {
			promises.push(tryGetScope());
		} else if (isGlobal || allowWithoutScope) {
			promises.push(null);
		} else {
			return next(new ProgrammerError(
				`Missing expected :scope request parameter in authenticateMiddleware()`
			));
		}

		return Promise.all(promises).then(([user, scope]) => {
			if (!user && !allowUnauthenticated) {
				return next(new UnauthorizedError(
					`JWT subject user does not exist`,
					{headers}
				));
			}

			if (!scope && !allowWithoutScope && !isGlobal) {
				return next(new UnauthorizedError(
					`Scope from :scope request parameter does not exist`,
					{headers}
				));
			}

			req.user = user;
			req.scope = scope;
			next();
			return null;
		}).catch((err) => {
			if (err.code === 'UNAUTHORIZED_ERROR' && redirect) {
				redirect(req, res, next);
				return null;
			}
			next(new StackedError(`Error in authenticateMiddleware()`, err));
			return null;
		});
	};
};

function defaultGetToken(req) {
	const str = req.get('Authorization');
	if (!isNonEmptyString(str)) return null;
	return str.replace(/^Bearer[\s]+/i, '');
}

function defaultGetScopeId(req) {
	return req.params.scope;
}

function decodeToken(options, headers, secret, token) {
	return new Promise((resolve, reject) => {
		JWT.verify(token, secret, options, (err, decodedToken) => {
			if (err) {
				if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
					return reject(new UnauthorizedError(
						err.message,
						{headers}
					));
				}
				return reject(new StackedError(
					`JWT verification error in authenticateMiddleware()`,
					err
				));
			}

			return resolve(decodedToken);
		});
	});
}
