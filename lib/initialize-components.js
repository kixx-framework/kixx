'use strict';

const ApplicationInterface = require(`./classes/application-interface`);
const FrameworkError = require(`./classes/framework-error`);

const {complement, isNumber, isNonEmptyString, isUndefined} = require(`../library`);

const defineFunction = require(`./define-function`);
const composeMiddleware = require(`./compose-middleware`);

const isNotUndefined = complement(isUndefined);

const DEFAULT_COMPONENT_INIT_TIMEOUT = 3000;

module.exports = defineFunction({
	name: `initializeComponents`,
	params: [],
	func: function initializeComponents(options, components, args) {
		options = options || Object.create(null);
		const COMPONENT_INIT_TIMEOUT = isNumber(options.componentInitTimeout) ?
			options.componentInitTimeout : DEFAULT_COMPONENT_INIT_TIMEOUT;

		const api = ApplicationInterface.create();

		const initializers = components.map((comp, index) => {
			const {key, initialize} = comp;

			return function wrappedComponent({api, args}, resolve, reject) {
				const TO = setTimeout(() => {
					const keyName = key || index;
					return reject(new FrameworkError(
						`Component ${keyName} failed to initialize within ${COMPONENT_INIT_TIMEOUT}ms`,
						initializeComponents
					));
				}, COMPONENT_INIT_TIMEOUT);

				initialize(
					api,
					args,
					function resolver(component) {
						const newApi = isNonEmptyString(key) && isNotUndefined(component) ? api.set(key, component) : api;
						clearTimeout(TO);
						return resolve({
							api: newApi,
							args
						});
					},
					function rejector(err) {
						clearTimeout(TO);
						return reject(err);
					}
				);
			};
		});

		return new Promise((resolve, reject) => {
			composeMiddleware(
				initializers,
				function initializationComplete(err, api) {
					if (err) return reject(err);
					return resolve(api);
				}
			)({api, args});
		}).then((res) => res.api);
	}
});
