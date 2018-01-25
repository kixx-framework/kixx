'use strict';

// Default configurations to be used by calling applications.

const noop = require(`./lib/store-middleware/no-op`);
const checkCreateConflict = require(`./lib/store-middleware/check-create-conflict`);
const emit = require(`./lib/store-middleware/emit`);
const generateId = require(`./lib/store-middleware/generate-id`);
const getObject = require(`./lib/store-middleware/get-object`);
const mergeObject = require(`./lib/store-middleware/merge-object`);
const removeObject = require(`./lib/store-middleware/remove-object`);
const scanObjectsByType = require(`./lib/store-middleware/scan-objects-by-type`);
const setObject = require(`./lib/store-middleware/set-object`);
const validateObjectExists = require(`./lib/store-middleware/validate-object-exists`);

exports.model = Object.freeze({
	afterCreate: [noop],
	afterGet: [noop],
	afterRemove: [noop],
	afterScan: [noop],
	afterUpdate: [noop],
	beforeCreate: [noop],
	beforeGet: [noop],
	beforeMerge: [noop],
	beforeRemove: [noop],
	beforeScan: [noop],
	beforeSet: [noop],
	beforeUpdate: [noop],
	checkCreateConflict: [checkCreateConflict],
	emit: [emit],
	generateId: [generateId],
	getObject: [getObject],
	mergeObject: [mergeObject],
	removeObject: [removeObject],
	scanObjectsByType: [scanObjectsByType],
	setObject: [setObject],
	validateBeforeCreate: [noop],
	validateBeforeGet: [noop],
	validateBeforeRemove: [noop],
	validateBeforeScan: [noop],
	validateBeforeUpdate: [noop],
	validateObjectExists: [validateObjectExists]
});
