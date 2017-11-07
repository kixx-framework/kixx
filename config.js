'use strict';

// Default configurations to be used by calling applications.

const noop = require(`./lib/store-middleware/no-op`);
const checkCreateConflict = require(`./lib/store-middleware/check-create-conflict`);
const emit = require(`./lib/store-middleware/emit`);
const getObject = require(`./lib/store-middleware/get-object`);
const mergeObject = require(`./lib/store-middleware/merge-object`);
const removeObject = require(`./lib/store-middleware/remove-object`);
const scanObjectsByType = require(`./lib/store-middleware/scan-objects-by-type`);
const setObject = require(`./lib/store-middleware/set-object`);

exports.model = {
	afterCreate: noop,
	afterGet: noop,
	afterRemove: noop,
	afterScan: noop,
	afterUpdate: noop,
	beforeCreate: noop,
	beforeGet: noop,
	beforeRemove: noop,
	beforeScan: noop,
	beforeUpdate: noop,
	checkCreateConflict,
	emit,
	getObject,
	mergeObject,
	removeObject,
	setObject,
	scanObjectsByType,
	validateBeforeCreate: noop,
	validateBeforeGet: noop,
	validateBeforeRemove: noop,
	validateBeforeScan: noop,
	validateBeforeUpdate: noop
};
