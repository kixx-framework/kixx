'use strict';

const Promise = require(`bluebird`);

module.exports = function serverWrapper(server) {
	const self = Object.create(null);

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
				resolve(self);
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
				resolve(self);
			});
		});
	}

	function address() {
		return server.address();
	}

	return Object.defineProperties(self, {
		start: {
			enumerable: true,
			value: start
		},
		stop: {
			enumerable: true,
			value: stop
		},
		address: {
			enumerable: true,
			value: address
		},
		server: {
			enumerable: true,
			value: server
		}
	});
};
