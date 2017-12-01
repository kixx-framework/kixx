'use strict';

exports.BadRequestError = require(`./lib/classes/bad-request-error`);
exports.ConflictError = require(`./lib/classes/conflict-error`);
exports.ForbiddenError = require(`./lib/classes/forbidden-error`);
exports.FrameworkError = require(`./lib/classes/framework-error`);
exports.InvariantError = require(`./lib/classes/invariant-error`);
exports.MethodNotAllowedError = require(`./lib/classes/method-not-allowed-error`);
exports.NotAcceptableError = require(`./lib/classes/not-acceptable-error`);
exports.NotFoundError = require(`./lib/classes/not-found-error`);
exports.NotImplementedError = require(`./lib/classes/not-implemented-error`);
exports.ProgrammerError = require(`./lib/classes/programmer-error`);
exports.StackedError = require(`./lib/classes/stacked-error`);
exports.UnauthorizedError = require(`./lib/classes/unauthorized-error`);
exports.UnprocessableError = require(`./lib/classes/unprocessable-error`);
exports.UnsupportedMediaTypeError = require(`./lib/classes/unsupported-media-type-error`);

exports.EventBus = require(`./lib/classes/event-bus`);
exports.CommandBus = require(`./lib/classes/command-bus`);
exports.StoreArgs = require(`./lib/classes/store-args`);

exports.composeMiddleware = require(`./lib/compose-middleware`);
exports.createApplicationStore = require(`./lib/create-application-store`);
exports.createJsonWebToken = require(`./lib/create-json-web-token`);
exports.createProcessManager = require(`./lib/create-process-manager`);
exports.defineFunction = require(`./lib/define-function`);
exports.httpFetchBuffer = require(`./lib/http-fetch-buffer`);
exports.httpSendBuffer = require(`./lib/http-send-buffer`);
exports.reportFullStackTrace = require(`./lib/report-full-stack-trace`);
exports.serverWrapper = require(`./lib/server-wrapper`);

const ExpressMiddleware = [
	`accept-json-api`,
	`allowed-methods`,
	`authenticate-scope`,
	`authenticate-user`,
	`authorize`,
	`collection-create`,
	`collection-list`,
	`create-transaction`,
	`cross-origin-request`,
	`default-error-handler`,
	`dispatch-method`,
	`handle-json-api-error`,
	`handle-not-found`,
	`relationships-append`,
	`relationships-list`,
	`relationships-remove`,
	`relationships-replace`,
	`request-options`,
	`resource-get`,
	`resource-remove`,
	`resource-update`,
	`validate-json-api-relationships-request`,
	`validate-json-api-resource-request`
];

exports.ExpressMiddleware = Object.freeze(ExpressMiddleware.reduce((middleware, filename) => {
	const fn = require(`./lib/express-middleware/${filename}`);
	middleware[fn.name] = fn;
	return middleware;
}, Object.create(null)));
