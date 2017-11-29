'use strict';

const Promise = require(`bluebird`);
const ProgrammerError = require(`./classes/programmer-error`);
const {isNonEmptyString} = require(`../library`);

const JWT = require(`jsonwebtoken`);

module.exports = function createJsonWebToken(payload, secret) {
	payload = payload || {};

	if (!isNonEmptyString(secret)) {
		throw new ProgrammerError(`createJsonWebToken() expects 'secret' argument to be a non empty String`);
	}

	return new Promise((resolve, reject) => {
		JWT.sign(payload, secret, (err, token) => {
			if (err) return reject(err);
			return resolve(token);
		});
	});
};
