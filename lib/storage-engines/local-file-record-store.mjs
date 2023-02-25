import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { helpers } from 'kixx-assert';

export function createLocalFileRecordStore(spec) {
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

	async function fetchRecord(includes, type, id, args) {
		const filepath = createRecordFilePath(type, id);
		const record = await readJsonFile(filepath);

		if (args.include && record && record.relationships) {

			const promises = Object.keys(record.relationships).map((key) => {
				if (!record.relationships[key]) {
					return includes;
				}

				return fetchRelatedRecords(includes, args, record.relationships[key]);
			});

			await Promise.all(promises);
		}

		return [ record, includes ];
	}

	async function fetchRelatedRecords(includes, args, relationships) {
		if (!Array.isArray(relationships)) {
			relationships = [ relationships ];
		}

		const promises = relationships.map((relationship) => {
			return fetchRecord(includes, relationship.type, relationship.id, args);
		});

		const results = await Promise.all(promises);

		results.forEach(([ record ]) => {
			if (record) {
				const existing = includes.find(({ type, id }) => {
					return record.type === type && record.id === id;
				});

				if (!existing) {
					includes.push(record);
				}
			}
		});

		return includes;
	}

	function sortDecendingByCreatedDate(a, b) {
		if (a.created === b.created) {
			return 0;
		}
		if (a.created < b.created) {
			return 1;
		}
		return -1;
	}

	return {

		initialize() {
			return Promise.resolve(true);
		},

		async get(type, id, args) {
			args = args || {};

			const [ record, includes ] = await fetchRecord([], type, id, args);

			if (record) {
				return [ record, includes ];
			}

			return [ null, null ];
		},

		async getByType(type, args) {
			const sortOrder = args.sortOrder;
			const limit = helpers.isNumberNotNaN(args.limit) ? args.limit : 100;
			const cursor = helpers.isNumberNotNaN(args.cursor) ? args.cursor : 0;

			const entries = await fsp.readdir(directory);

			const files = entries.filter((entry) => entry.startsWith(type));

			const promises = files.map((entry) => {
				const filepath = path.join(directory, entry);
				return readJsonFile(filepath);
			});

			const records = await Promise.all(promises);

			records.sort(sortDecendingByCreatedDate);

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

		async put(record) {
			const { type, id } = record;
			await saveRecord(type, id, record);
			return record;
		},
	};
}
