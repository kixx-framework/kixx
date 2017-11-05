'use strict';

const defineFunction = require(`./define-function`);

module.exports = defineFunction({
	name: `createApplicationStore`,
	params: [],
	func: function createApplicationStore(modelConfigs) {
		const models = {};

		return Object.defineProperties(Object.create(null), {
			// beforeCreate
			// validateBeforeCreate
			// getObject
			// checkCreateConflict
			// setObject
			// afterCreate
			create: {
				value: function create(scope, object) {
					const {type} = object;
					const Model = models[type];
					return Model.create(scope, object);
				}
			},
			// beforeGet
			// getObject
			// afterGet
			get: {
				value: function get(scope, key) {
					const {type} = key;
					const Model = models[type];
					return Model.get(scope, key);
				}
			},
			// beforeUpdate
			// validateBeforeUpdate
			// getObject
			// mergeObject
			// setObject
			// afterUpdate
			update: {
				value: function update(scope, object) {
					const {type} = object;
					const Model = models[type];
					return Model.update(scope, object);
				}
			},
			// beforeRemove
			// removeObject
			// afterRemove
			remove: {
				value: function remove(scope, key) {
					const {type} = key;
					const Model = models[type];
					return Model.remove(scope, key);
				}
			},
			// beforeScan
			// scanByType
			// afterScan
			scan: {
				value: function scan(scope, params) {
					const {type} = params;
					const Model = models[type];
					return Model.scan(scope, params);
				}
			}
		});
	}
});
