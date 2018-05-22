'use strict';

const {assert} = require('../library');
const index = require('../index');

const BadRequestError = require('../lib/errors/bad-request-error');
const ConflictError = require('../lib/errors/conflict-error');
const ForbiddenError = require('../lib/errors/forbidden-error');
const MethodNotAllowedError = require('../lib/errors/method-not-allowed-error');
const NotAcceptableError = require('../lib/errors/not-acceptable-error');
const NotFoundError = require('../lib/errors/not-found-error');
const NotImplementedError = require('../lib/errors/not-implemented-error');
const StackedError = require('../lib/errors/stacked-error');
const UnauthorizedError = require('../lib/errors/unauthorized-error');
const UnprocessableError = require('../lib/errors/unprocessable-error');
const UnsupportedMediaTypeError = require('../lib/errors/unsupported-media-type-error');
const UserError = require('../lib/errors/user-error');

module.exports = function (t) {
	t.it('defines BadRequestError', () => {
		assert.isEqual(BadRequestError, index.BadRequestError);
	});
	t.it('defines ConflictError', () => {
		assert.isEqual(ConflictError, index.ConflictError);
	});
	t.it('defines ForbiddenError', () => {
		assert.isEqual(ForbiddenError, index.ForbiddenError);
	});
	t.it('defines MethodNotAllowedError', () => {
		assert.isEqual(MethodNotAllowedError, index.MethodNotAllowedError);
	});
	t.it('defines NotAcceptableError', () => {
		assert.isEqual(NotAcceptableError, index.NotAcceptableError);
	});
	t.it('defines NotFoundError', () => {
		assert.isEqual(NotFoundError, index.NotFoundError);
	});
	t.it('defines NotImplementedError', () => {
		assert.isEqual(NotImplementedError, index.NotImplementedError);
	});
	t.it('defines StackedError', () => {
		assert.isEqual(StackedError, index.StackedError);
	});
	t.it('defines UnauthorizedError', () => {
		assert.isEqual(UnauthorizedError, index.UnauthorizedError);
	});
	t.it('defines UnprocessableError', () => {
		assert.isEqual(UnprocessableError, index.UnprocessableError);
	});
	t.it('defines UnsupportedMediaTypeError', () => {
		assert.isEqual(UnsupportedMediaTypeError, index.UnsupportedMediaTypeError);
	});
	t.it('defines UserError', () => {
		assert.isEqual(UserError, index.UserError);
	});
};
