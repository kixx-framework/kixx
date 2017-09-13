'use strict';

module.exports = (app) => {
	return function handleErrorController(err, req, res) {
		if (app.isDevMode()) {
			console.error(err.stack || err.message || err); // eslint-disable-line no-console
		} else {
			app.logger.error(`http request/response error`, err);
		}

		try {
			// It is possible that this controller will be called after an HTTP
			// response has already been sent, causing the following code to throw
			// another error.
			res
				.setStatus(500)
				.sendHTML(`<html><body><h1>Server Error</h1></body></html>`);
		} catch (err) {
			if (app.isDevMode()) {
				console.error(err.stack || err.message || err); // eslint-disable-line no-console
			} else {
				app.logger.error(`http response failure`, err);
			}
		}
	};
};
