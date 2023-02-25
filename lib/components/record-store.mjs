import { OperationalError, ProgrammerError, NotFoundError } from 'kixx-server-errors';
import { helpers } from 'kixx-assert';
import { v4 as uuidv4 } from 'uuid';

export function createRecordStore(params) {
	const {
		scope,
		storageEngine,
		entityTypes,
	} = params;

	const entityConstructorsByType = new Map();

	entityTypes.forEach((EntityConstructor) => {
		entityConstructorsByType.set(EntityConstructor.type, EntityConstructor);
	});

	function mapRecordToEntityConstructor(record) {
		const EntityConstructor = entityConstructorsByType.get(record.type);

		if (!EntityConstructor) {
			throw new OperationalError(`The type "${ record.type }" has not be registered`);
		}

		return EntityConstructor.fromDatabaseRecord(record);
	}

	return {
		initialize() {
			return storageEngine.initialize();
		},

		async get(type, id, args) {
			args = args || {};

			if (!helpers.isNonEmptyString(type)) {
				throw new ProgrammerError('The record.type must be a non empty string.');
			}
			if (!helpers.isNonEmptyString(id)) {
				throw new ProgrammerError('The record.id must be a non empty string.');
			}
			if (!entityConstructorsByType.has(type)) {
				throw new ProgrammerError(`The type "${ type }" has not be registered`);
			}

			const [ record, includes ] = await storageEngine.get(type, id, args);

			if (!record) {
				throw new NotFoundError(`Requested record ${ type }:${ id } could not be found`);
			}

			return [
				mapRecordToEntityConstructor(record),
				includes.map(mapRecordToEntityConstructor),
			];
		},

		async getByType(type, args) {
			args = args || {};

			if (!helpers.isNonEmptyString(type)) {
				throw new ProgrammerError('The type parameter must be a non empty string.');
			}
			if (!entityConstructorsByType.has(type)) {
				throw new ProgrammerError(`The type "${ type }" has not be registered`);
			}

			const result = await storageEngine.getByType(type, args);

			const records = result.records.map(mapRecordToEntityConstructor);

			return {
				count: result.count,
				cursor: result.cursor,
				records,
			};
		},

		async create(record) {
			if (!helpers.isNonEmptyString(record.type)) {
				throw new ProgrammerError('The record.type must be a non empty string.');
			}
			if (!entityConstructorsByType.has(record.type)) {
				throw new ProgrammerError(`The type "${ record.type }" has not be registered`);
			}
			if (typeof record.id !== 'undefined') {
				throw new ProgrammerError('The record.id must not be defined for a new record.');
			}

			const EntityConstructor = entityConstructorsByType.get(record.type);
			const isoDateString = new Date().toISOString();

			const meta = {
				scope,
				type: EntityConstructor.type,
				id: uuidv4(),
				created: isoDateString,
				updated: isoDateString,
			};

			record = Object.assign(structuredClone(record), meta);

			await storageEngine.put(record);

			return record;
		},

		async update(record) {
			if (!helpers.isNonEmptyString(record.type)) {
				throw new ProgrammerError('The record.type must be a non empty string.');
			}
			if (!entityConstructorsByType.has(record.type)) {
				throw new ProgrammerError(`The type "${ record.type }" has not be registered`);
			}
			if (!helpers.isNonEmptyString(record.id)) {
				throw new ProgrammerError('The record.id must be defined for an existing record.');
			}

			const EntityConstructor = entityConstructorsByType.get(record.type);

			const meta = {
				scope,
				type: EntityConstructor.type,
				id: record.id,
				created: record.created,
				updated: new Date().toISOString(),
			};

			record = Object.assign(structuredClone(record), meta);

			await storageEngine.put(record);

			return record;
		},
	};
}
