'use strict';

const handleError = require(`./controllers/handle-error`);
const handleNotFound = require(`./controllers/handle-not-found`);

function jsonapi(app) {
	return function jsonapiController(req, res) {
		app.logger.debug(`jsonapi`);
		res.sendJSON({jsonapi: `0.0.0`});
	};
}

module.exports = (app, router) => {
	return router

		.addErrorHandler(handleError(app))

		.addNotFoundHandler(handleNotFound(app))

		.route(
			`/jsonapi/*`,
			jsonapi(app)
		);
};
