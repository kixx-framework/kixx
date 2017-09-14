'use strict';

const R = require(`ramda`);
const Filepath = require(`filepath`);
const UserError = require(`./lib/types/user-error`);
const Router = require(`./lib/types/router`);
const server = require(`./lib/namespaces/server`);
const app = require(`./lib/namespaces/app`);
const router = require(`./lib/namespaces/router`);
const routes = require(`./lib/routes`);

const startServer = server.start;
const initializeApp = app.initialize;
const createRequestHandler = router.createRequestHandler;

const DEFAULT_PORT = 3000;
const DEFAULT_HOSTNAME = `localhost`;

const defaultPort = R.pathOr(DEFAULT_PORT, [`server`, `port`]);
const defaultHostname = R.pathOr(DEFAULT_HOSTNAME, [`server`, `hostname`]);

exports.start = function start(dir, env) {
	const appdir = Filepath.create(dir);
	const packageJson = appdir.append(`package.json`);
	const configJs = appdir.append(`config.js`);

	let pkg;
	try {
		pkg = require(packageJson.path);
	} catch (err) {
		if (err.code === `MODULE_NOT_FOUND`) {
			throw new UserError(
				`Missing package.json in the root of your project.`
			);
		}
		throw err;
	}

	let config;
	try {
		config = require(configJs.path);
	} catch (err) {
		if (err.code === `MODULE_NOT_FOUND`) {
			config = {};
		} else {
			throw err;
		}
	}

	return initializeApp(appdir, pkg, config, env).then((app) => {
		const port = defaultPort(app.config);
		const hostname = defaultHostname(app.config);

		const router = routes(app, new Router());
		const handler = createRequestHandler(router);

		return startServer(handler, hostname, port).then((server) => {
			return {app, server};
		});
	});
};

