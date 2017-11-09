'use strict';

const {isObject, isNonEmptyString, mergeDeep} = require(`../library`);
const {ProgrammerError} = require(`../index`);

module.exports = function mergeStoreRecords(target, source) {
	if (!isObject(target)) {
		throw new ProgrammerError(
			`mergeStoreRecords() requires target to be a plain Object`
		);
	}
	if (!isObject(source)) {
		throw new ProgrammerError(
			`mergeStoreRecords() requires source to be a plain Object`
		);
	}

	const {type, id} = target;

	if (!isNonEmptyString(type)) {
		throw new ProgrammerError(
			`mergeStoreRecords() requires target.type to be a non empty String`
		);
	}
	if (source.type !== type) {
		throw new ProgrammerError(
			`mergeStoreRecords() requires source.type "${source.type}" to match target.type "${type}"`
		);
	}
	if (!isNonEmptyString(id)) {
		throw new ProgrammerError(
			`mergeStoreRecords() requires target.id to be a non empty String`
		);
	}
	if (source.id !== id) {
		throw new ProgrammerError(
			`mergeStoreRecords() requires source.id "${source.id}" to match target.id "${id}"`
		);
	}

	// Merge attributes.
	// Our merge algorithm creates a new object. It does not mutate the
	// existing objects in any way.
	const attributes = target.attributes ? mergeDeep(
		target.attributes,
		source.attributes
	) : source.attributes || Object.create(null);

	// Merge relationships.
	// Our merge algorithm creates a new object. It does not mutate the
	// existing objects in any way.
	const relationships = target.relationships ? mergeDeep(
		target.relationships,
		source.relationships
	) : source.relationships || Object.create(null);

	// Merge meta.
	// Our merge algorithm creates a new object. It does not mutate the
	// existing objects in any way.
	const meta = target.meta ? mergeDeep(
		target.meta,
		source.meta
	) : source.meta || Object.create(null);

	return {type, id, attributes, relationships, meta};
};
