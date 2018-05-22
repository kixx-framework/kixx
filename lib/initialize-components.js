'use strict';

const Promise = require('bluebird');
const ImmutableHash = require('./classes/immutable-hash');
const {complement, isNumber, isNonEmptyString, isUndefined} = require('../library');
const composeMiddleware = require('./compose-middleware');

const isNotUndefined = complement(isUndefined);

const DEFAULT_COMPONENT_INIT_TIMEOUT = 3000;

module.exports = function initializeComponents(options, components, args) {
	options = options || Object.create(null);
	const COMPONENT_INIT_TIMEOUT = isNumber(options.componentInitTimeout) ?
		options.componentInitTimeout : DEFAULT_COMPONENT_INIT_TIMEOUT;

	const api = ImmutableHash.create();

	const initializers = components.map((comp, index) => {
		const {key, initialize} = comp;

		return function wrappedComponent({api, args}, resolve, reject) {
			const TO = setTimeout(() => {
				const keyName = key || index;
				return reject(new Error(
					`Component ${keyName} failed to initialize within ${COMPONENT_INIT_TIMEOUT}ms`
				));
			}, COMPONENT_INIT_TIMEOUT);

			initialize(
				api,
				args,
				function resolver(component) {
					clearTimeout(TO);
					let newApi;
					if (isNonEmptyString(key) && isNotUndefined(component)) {
						const props = {};
						props[key] = component;
						newApi = api.set(props);
					} else {
						newApi = api;
					}
					return resolve({api: newApi, args});
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
};
