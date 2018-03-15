'use strict';

// TODO: Add cache control middleware.
// TODO: Add cookie parsing middleware.
// TODO: Add set cookie middleware.
// TODO: Add log request response middleware.
// TODO: Add redirect middleware.
// TODO: Add render template middleware.
// TODO: Add authorizationOutput middleware to filter and/or decorate resource and included data.

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
exports.UserError = require(`./lib/classes/user-error`);

exports.ApplicationInterface = require(`./lib/classes/application-interface`);
exports.EventBus = require(`./lib/classes/event-bus`);
exports.CommandBus = require(`./lib/classes/command-bus`);
exports.Logger = require(`./lib/classes/logger`);
exports.StoreArgs = require(`./lib/classes/store-args`);

exports.composeLink = require(`./lib/compose-link`);
exports.composeMiddleware = require(`./lib/compose-middleware`);
exports.computeObjectHash = require(`./lib/compute-object-hash`);
exports.createApplicationStore = require(`./lib/create-application-store`);
exports.createJsonWebToken = require(`./lib/create-json-web-token`);
exports.createProcessManager = require(`./lib/create-process-manager`);
exports.defineFunction = require(`./lib/define-function`);
exports.httpFetchBuffer = require(`./lib/http-fetch-buffer`);
exports.httpSendBuffer = require(`./lib/http-send-buffer`);
exports.initializeComponents = require(`./lib/initialize-components`);
exports.parseJsonWebToken = require(`./lib/parse-json-web-token`);
exports.reportFullStackTrace = require(`./lib/report-full-stack-trace`);
exports.runTask = require(`./lib/run-task`);
exports.serverWrapper = require(`./lib/server-wrapper`);
exports.uuidV1 = require(`uuid/v1`);
exports.uuidV3 = require(`uuid/v3`);
exports.uuidV4 = require(`uuid/v4`);
exports.uuidV5 = require(`uuid/v5`);

const ExpressMiddleware = [
	`accept-json-api`,
	`allowed-methods`,
	`authenticate-scope`,
	`authenticate-user`,
	`authorize`,
	`body-to-json-api`,
	`collection-create`,
	`collection-list`,
	`create-transaction`,
	`cross-origin-request`,
	`default-error-handler`,
	`dispatch-method`,
	`handle-json-api-error`,
	`handle-not-found`,
	`parse-body`,
	`relationships-append`,
	`relationships-list`,
	`relationships-remove`,
	`relationships-replace`,
	`request-options`,
	`resource-get`,
	`resource-remove`,
	`resource-update`,
	`send-json-api`,
	`validate-json-api-relationships-request`,
	`validate-json-api-resource-request`
];

exports.ExpressMiddleware = Object.freeze(ExpressMiddleware.reduce((middleware, filename) => {
	const fn = require(`./lib/express-middleware/${filename}`);
	middleware[fn.name] = fn;
	return middleware;
}, Object.create(null)));

const StoreMiddleware = [
	`check-create-conflict`,
	`emit`,
	`generate-id`,
	`get-object`,
	`merge-object`,
	`no-op`,
	`not-implemented`,
	`remove-object`,
	`scan-objects-by-type`,
	`set-object`,
	`validate-object-exists`
];

exports.StoreMiddleware = Object.freeze(StoreMiddleware.reduce((middleware, filename) => {
	const fn = require(`./lib/store-middleware/${filename}`);
	middleware[fn.name] = fn;
	return middleware;
}, Object.create(null)));
