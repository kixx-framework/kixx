'use strict';

const Promise = require(`bluebird`);
const App = require(`../types/app`);
const Logger = require(`../types/logger`);
const lib = require(`../`);

const isFunction = lib.isFunction;

// Helper to run the initializers.
exports.initialize = (dir, pkg, config, env) => {
	const app = exports.createApp(dir, pkg, config, env);
	const initializers = app.config.initializers || [];

	// Serially load initializers, passing the app object into each one.
	return initializers.reduce((promise, initializerName) => {
		const initializer = require(app.appdir.append(`initializers`, initializerName).path);

		return promise.then((app) => {
			return Promise.resolve(initializer(app)).then((app) => {
				if (!App.is(app)) {
					return Promise.reject(new Error(
						`Intializer "${initializerName}" did not return an instance of App.`
					));
				}
				return app;
			});
		});
	}, Promise.resolve(app));
};

// Helper to create a new App instance.
exports.createApp = (appdir, pkg, config, environment) => {
	if (!appdir || !isFunction(appdir.isDirectory) || !appdir.isDirectory()) {
		throw new Error(
			`createApp() appdir must be a Filepath instance representing the application directory`
		);
	}

	const app = new App({
		name: pkg.name,
		version: pkg.version,
		appdir,
		environment,
		logger: new Logger()
	});

	return app.setConfig(config);
};
