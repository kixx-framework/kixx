import { OperationalError, ProgrammerError, NotFoundError } from 'kixx-server-errors';
import { helpers } from 'kixx-assert';

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

		async updateOrCreate(record) {
			const { id } = record;

			if (!helpers.isNonEmptyString(record.type)) {
				throw new ProgrammerError('The record.type must be a non empty string.');
			}
			if (!entityConstructorsByType.has(record.type)) {
				throw new ProgrammerError(`The type "${ record.type }" has not be registered`);
			}
			if (!helpers.isNonEmptyString(id)) {
				throw new ProgrammerError('The record.id must be a non empty string.');
			}

			const EntityConstructor = entityConstructorsByType.get(record.type);
			const type = EntityConstructor.type;

			record = Object.assign({}, record, { scope, type });

			await storageEngine.updateOrCreate(type, id, record);

			return record;
		},
	};
}
