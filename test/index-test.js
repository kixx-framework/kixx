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

const ImmutableHash = require('../lib/classes/immutable-hash');

const composeMiddleware = require('../lib/compose-middleware');
const computeObjectHash = require('../lib/compute-object-hash');
const initializeComponents = require('../lib/initialize-components');
const reportFullStackTrace = require('../lib/report-full-stack-trace');

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
	t.it('defines ImmutableHash', () => {
		assert.isEqual(ImmutableHash, index.ImmutableHash);
	});
	t.it('defines composeMiddleware', () => {
		assert.isEqual(composeMiddleware, index.composeMiddleware);
	});
	t.it('defines computeObjectHash', () => {
		assert.isEqual(computeObjectHash, index.computeObjectHash);
	});
	t.it('defines initializeComponents', () => {
		assert.isEqual(initializeComponents, index.initializeComponents);
	});
	t.it('defines reportFullStackTrace', () => {
		assert.isEqual(reportFullStackTrace, index.reportFullStackTrace);
	});
};
