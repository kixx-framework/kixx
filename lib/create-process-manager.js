'use strict';

const Promise = require(`bluebird`);

const FrameworkError = require(`./classes/framework-error`);
const ComponentRegistry = require(`./classes/component-registry`);
const {isNumber, has, assoc, append} = require(`./library`);
const defineFunction = require(`./define-function`);
const composeMiddleware = require(`./compose-middleware`);

const DEFAULT_COMPONENT_INIT_TIMEOUT = 3000;

module.exports = defineFunction({
	name: `createProcessManager`,
	params: [],
	func: function createProcessManager(options) {
		const COMPONENT_INIT_TIMEOUT = isNumber(options.componentInitTimeout) ?
			options.componentInitTimeout : DEFAULT_COMPONENT_INIT_TIMEOUT;

		function walkInitializers(initializers, comp) {
			// - name: The name String of the component.
			// - deps: The dependencies List for the component.
			// - initialize: The initializer function for the component.
			const {name, deps, initialize} = comp;

			// Walk the dependency tree children first.
			if (deps && deps.length > 0) {
				initializers = deps.reduce((initializers, dep) => {
					return walkInitializers(initializers, dep);
				}, initializers);
			}

			function invokeInitializer(registry, resolve, reject) {
				// If this component is already initialized, skip it.
				if (has(name, registry)) return resolve(registry);

				const TO = setTimeout(() => {
					return reject(new FrameworkError(
						`Component ${name} failed to initialize within ${COMPONENT_INIT_TIMEOUT}ms`,
						createProcessManager
					));
				});

				function resolver(comp) {
					clearTimeout(TO);
					// Resolve to the next invoker Function, passing it an updated registry.
					return resolve(assoc(
						name,
						{name, deps, comp},
						registry
					));
				}

				function rejector(err) {
					clearTimeout(TO);
					return reject(err);
				}

				try {
					initialize(
						new ComponentRegistry({
							registry,
							dependencies: deps.map((dep) => dep.name)}
						),
						resolver,
						rejector
					);
				} catch (err) {
					rejector(err);
				}
				return null;
			}

			// Return a new copy of the component registry after adding this component to it.
			return append(invokeInitializer, initializers);
		}

		// The public initialization function returned from createProcessManager().
		return function initialize(component) {
			return new Promise((resolve, reject) => {
				const composedInitializer = composeMiddleware(
					walkInitializers([], component),
					function initializationComplete(err, registry) {
						if (err) return reject(err);
						return reject(true);
					}
				);

				composedInitializer(Object.create(null));
			});
		};
	}
});
