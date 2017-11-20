'use strict';

const Promise = require(`bluebird`);

module.exports = function serverWrapper(server) {
	function start(port, hostname) {
		return new Promise((resolve, reject) => {
			server.once(`error`, (err) => {
				// Handle specific listen errors with friendly messages
				if (err.code === `EACCES`) {
					err = new Error(`port ${port} requires elevated privileges`);
				} else if (err.code === `EADDRINUSE`) {
					err = new Error(`port ${port} is already in use`);
				}

				reject(err);
			});

			server.on(`listening`, () => {
				resolve(server);
			});

			if (hostname) {
				server.listen(port, hostname);
			} else {
				server.listen(port);
			}
		});
	}

	function stop() {
		return new Promise((resolve, reject) => {
			server.once(`error`, reject);
			server.close((err) => {
				if (err) return reject(err);
				resolve(server);
			});
		});
	}

	return Object.defineProperties(Object.create(null), {
		start: {
			enumerable: true,
			value: start
		},
		stop: {
			enumerable: true,
			value: stop
		}
	});
};
