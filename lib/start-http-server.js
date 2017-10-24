'use strict';

const Promise = require(`bluebird`);
const {createServer} = require(`http`);
const defineFunction = require(`./define-function`);

module.exports = defineFunction({
	name: `startHttpServer`,
	params: [],
	func: function startHttpServer({port, hostname, handler}) {
		return new Promise((resolve, reject) => {
			const server = createServer(handler);
			let listening = false;

			server.on(`error`, (err) => {
				// Handle specific listen errors with friendly messages
				if (err.code === `EACCES`) {
					err = new Error(`port ${port} requires elevated privileges`);
				} else if (err.code === `EADDRINUSE`) {
					err = new Error(`port ${port} is already in use`);
				}

				if (listening) {
					throw err;
				} else {
					reject(err);
				}
			});

			server.on(`listening`, () => {
				listening = true;
				resolve(server);
			});

			server.listen(port, hostname);
		});
	}
});
