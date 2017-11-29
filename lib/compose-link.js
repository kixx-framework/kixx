'use strict';

const {curry} = require(`../library`);

module.exports = curry(function composeLink(getPath, req) {
	const protocol = req.protocol;
	let hostname = req.hostname;

	const env = req.app.get(`env`);
	if (env === `development` || env === `test`) {
		const port = req.app.get(`port`);
		if (port) {
			hostname = `${hostname}:${port}`;
		}
	}

	return `${protocol}://${hostname}${getPath(req)}`;
});
