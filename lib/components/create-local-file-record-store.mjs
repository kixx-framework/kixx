import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { helpers } from 'kixx-assert';
import { NotFoundError, ProgrammerError } from 'kixx-server-errors';

export default function createLocalFileRecordStore(spec) {
	const { directory } = spec;

	fs.mkdirSync(directory, { recursive: true });

	function createRecordFilePath(type, id) {
		return path.join(directory, `${ type }_${ id }.json`);
	}

	async function readJsonFile(filepath) {
		try {
			const stats = await fsp.stat(filepath);

			if (stats.isFile()) {
				const utf8Data = await fsp.readFile(filepath, { encoding: 'utf8' });
				return JSON.parse(utf8Data);
			}

			return null;
		} catch (cause) {
			if (cause.code === 'ENOENT') {
				return null;
			}

			throw cause;
		}
	}

	function writeJsonFile(filepath, record) {
		const utf8Data = JSON.stringify(record, null, 2);
		return fsp.writeFile(filepath, utf8Data, { encoding: 'utf8' });
	}

	function saveRecord(type, id, record) {
		const filepath = createRecordFilePath(type, id);
		return writeJsonFile(filepath, record);
	}

	async function fetchRecord(type, id, args) {
		const filepath = createRecordFilePath(type, id);
		const record = await readJsonFile(filepath);

		if (args.include && record && record.relationships) {
			const promises = Object.keys(record.relationships).map((key) => {
				return fetchAndMergeRelatedRecords(args, record.relationships[key]);
			});

			await Promise.all(promises);
		}

		return record;
	}

	function fetchAndMergeRelatedRecords(args, relationships) {
		if (!Array.isArray(relationships)) {
			relationships = [ relationships ];
		}

		const promises = relationships.map((relationship) => {
			return fetchAndMergeRelatedRecord(args, relationship);
		});

		return Promise.all(promises);
	}

	async function fetchAndMergeRelatedRecord(args, relationship) {
		const record = await fetchRecord(relationship.type, relationship.id, args);

		if (record) {
			Object.assign(relationship, record);
		}

		return record;
	}

	function sortAscendingByCreatedDate(a, b) {
		if (a.created === b.created) {
			return 0;
		}
		if (a.created < b.created) {
			return -1;
		}
		return 1;
	}

	return {
		async get(type, id, args) {
			args = args || {};

			const record = await fetchRecord(type, id, args);

			if (record) {
				return record;
			}

			throw new NotFoundError(
				`Requested record ${ type }:${ id } could not be found`
			);
		},

		async getByType(type, args) {
			const {
				cursor,
				limit,
				sortOrder,
			} = args;

			const entries = await fsp.readdir(directory);

			const files = entries.filter((entry) => entry.startsWith(type));

			const promises = files.map((entry) => {
				const filepath = path.join(directory, entry);
				return readJsonFile(filepath);
			});

			const records = await Promise.all(promises);

			records.sort(sortAscendingByCreatedDate);

			if (sortOrder === 'REVERSE') {
				records.reverse();
			}

			const subset = records.slice(cursor, cursor + limit);

			let newCursor = cursor + limit;
			if (typeof records[newCursor] === 'undefined') {
				newCursor = null;
			}

			return {
				count: subset.length,
				cursor: newCursor,
				records: subset,
			};
		},

		async updateOrCreate(record) {
			const { type, id } = record;

			if (!helpers.isNonEmptyString(type)) {
				throw new ProgrammerError('The record.type must be a non empty string.');
			}
			if (!helpers.isNonEmptyString(id)) {
				throw new ProgrammerError('The record.id must be a non empty string.');
			}

			await saveRecord(type, id, record);
		},
	};
}
