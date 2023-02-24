import fs from 'node:fs';
import path from 'node:path';
import { OperationalError, NotFoundError } from 'kixx-server-errors';
import { ErrorEvent } from '../events.mjs';
import { onStreamFinished } from '../file-utils.mjs';

export function createLocalFileObjectStore(params) {
	const {
		eventBus,
		scope,
		directory,
	} = params;

	fs.mkdirSync(directory, { recursive: true });

	function emitError(error, callback) {
		eventBus.emit(new ErrorEvent(error));
		callback(error);
	}

	function createObjectFilePath(id) {
		return path.join(directory, id);
	}

	function createMetaRecordFilePath(id) {
		return path.join(directory, `${ id }.json`);
	}

	function writeMetaFile(data, callback) {
		const { id } = data;
		const utf8Data = JSON.stringify(data, null, 2);
		const filepath = createMetaRecordFilePath(id);

		fs.writeFile(filepath, utf8Data, { encoding: 'utf8' }, (cause) => {
			if (cause) {
				callback(new OperationalError(
					'Encountered file write error while writing object metadata file',
					{ cause, info: { filepath } }
				));
			} else {
				callback(null, data);
			}
		});
	}

	function readMetaFile(id, callback) {
		const filepath = createMetaRecordFilePath(id);

		fs.readFile(filepath, { encoding: 'utf8' }, (cause, utf8Data) => {
			if (cause) {
				callback(new NotFoundError(
					'Encountered file read error while reading object metadata file',
					{ cause, info: { filepath } }
				));
			} else {
				callback(null, JSON.parse(utf8Data));
			}
		});
	}

	function writeObjectAndMetafile(args, readStream, callback) {
		const { id, contentType } = args;

		const filepath = createObjectFilePath(id);

		// TODO: Use the proper encoding for the file type.
		const writeStream = fs.createWriteStream(filepath, { encoding: null });

		readStream.on('error', (cause) => {
			emitError(new OperationalError(
				'Encountered read stream error event while writing object',
				{ cause, info: { filepath } }
			), callback);
		});

		writeStream.on('error', (cause) => {
			emitError(new OperationalError(
				'Encountered write stream error event while writing object',
				{ cause, info: { filepath } }
			), callback);
		});

		readStream.pipe(writeStream);

		onStreamFinished(writeStream, () => {
			writeStream.destroy();
			readStream.destroy();

			const data = {
				scope,
				type: 'object',
				id,
				contentType,
			};

			writeMetaFile(data, callback);
		});
	}

	function readMetafileAndObject(args, writeStream, callback) {
		const { id } = args;

		readMetaFile(id, (err, metadata) => {
			if (err) {
				callback(err);
				return;
			}

			const {
				type,
				contentType,
			} = metadata;

			const filepath = createObjectFilePath(id);
			const readStream = fs.createReadStream(filepath);

			readStream.on('error', (cause) => {
				emitError(new OperationalError(
					'Encountered read stream error event while reading object',
					{ cause, info: { filepath } }
				), callback);
			});

			writeStream.on('error', (cause) => {
				emitError(new OperationalError(
					'Encountered write stream error event while reading object',
					{ cause, info: { filepath } }
				), callback);
			});

			onStreamFinished(writeStream, () => {
				writeStream.destroy();
				readStream.destroy();
			});

			callback(null, {
				scope,
				type,
				id,
				contentType,
			});
		});
	}

	return {

		writeObject(args, readStream) {
			const { id, contentType } = args;

			return new Promise((resolve, reject) => {
				writeObjectAndMetafile({ id, contentType }, readStream, (err, result) => {
					if (err) {
						reject(err);
					} else {
						resolve(result);
					}
				});
			});
		},

		readObject(args, writeStream) {
			const { id } = args;

			return new Promise((resolve, reject) => {
				readMetafileAndObject({ id }, writeStream, (err, metadata) => {
					if (err) {
						reject(err);
					} else {
						resolve(metadata);
					}
				});
			});
		},
	};
}
