'use strict';

const ProgrammerError = require('./errors/programmer-error');
const {isNonEmptyString} = require('../library');
const JWT = require('jsonwebtoken');

module.exports = function parseJsonWebToken(token) {
	if (!isNonEmptyString(token)) {
		throw new ProgrammerError(
			`parseJsonWebToken() expects 'token' argument to be a non empty String`
		);
	}

	// For more info:
	//   https://github.com/auth0/node-jsonwebtoken#jwtdecodetoken--options
	return JWT.decode(token);
};
