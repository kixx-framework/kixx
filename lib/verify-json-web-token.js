'use strict';

const Promise = require('bluebird');
const ProgrammerError = require('./errors/programmer-error');
const UnauthorizedError = require('./errors/unauthorized-error');
const {isNonEmptyString} = require('../library');
const JWT = require('jsonwebtoken');

const UNAUTHORIZED_HEADERS = {
	'WWW-Authenticate': 'Bearer'
};

module.exports = function verifyJsonWebToken(options, secret, token) {
	if (!isNonEmptyString(token)) {
		throw new ProgrammerError(
			`verifyJsonWebToken() expects 'token' argument to be a non empty String`
		);
	}
	if (!isNonEmptyString(secret)) {
		throw new ProgrammerError(
			`verifyJsonWebToken() expects 'secret' argument to be a non empty String`
		);
	}

	const headers = options.headers ? Object.assign({}, UNAUTHORIZED_HEADERS, options.headers) : UNAUTHORIZED_HEADERS;

	return new Promise((resolve, reject) => {
		JWT.verify(token, secret, options, (err, decoded) => {
			if (err) {
				if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
					return reject(new UnauthorizedError(
						err.message,
						{headers}
					));
				}
				return reject(err);
			}

			return resolve(decoded);
		});
	});
};
