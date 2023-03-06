// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { OperationalError, NotFoundError } from 'kixx-server-errors';
// Imported for type checking
// eslint-disable-next-line no-unused-vars
import EventBus from '../lib/event-bus.js';
import { ErrorEvent } from '../lib/events.js';
import { onStreamFinished } from '../lib/file-utils.js';

export default class LocalFileObjectStore {

    #eventBus;
    #directory;
    #logger;

    /**
     * @param {{directory:String}} spec
     */
    constructor(spec) {
        this.#directory = spec.directory;
    }

    initialize(appContext) {
        return new Promise((resolve, reject) => {
            this.#eventBus = appContext.eventBus;
            this.#logger = appContext.logger;

            fs.mkdir(this.#directory, { recursive: true }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(this);
                }
            });
        });
    }

    writeObject(record, readStream) {
        return new Promise((resolve, reject) => {
            this.#writeObjectAndMetafile(record, readStream, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    readObject(id) {
        return new Promise((resolve, reject) => {
            this.#readMetafileAndObject(id, (err, [ metadata, readStream ]) => {
                if (err) {
                    reject(err);
                } else {
                    resolve([ metadata, readStream ]);
                }
            });
        });
    }

    #writeObjectAndMetafile(record, readStream, callback) {
        const filepath = this.#createObjectFilePath(record.id);

        // TODO: Use the proper encoding for the file type.
        // @ts-ignore error TS2322: Type 'null' is not assignable to type 'BufferEncoding | undefined'
        const writeStream = fs.createWriteStream(filepath, { encoding: null });

        readStream.on('error', (cause) => {
            this.#emitError(new OperationalError(
                'Encountered read stream error event while writing object',
                { cause, info: { filepath } }
            ), callback);
        });

        writeStream.on('error', (cause) => {
            this.#emitError(new OperationalError(
                'Encountered write stream error event while writing object',
                { fatal: true, cause, info: { filepath } }
            ), callback);
        });

        readStream.pipe(writeStream);

        onStreamFinished(writeStream, () => {
            writeStream.destroy();
            this.#writeMetaFile(record, callback);
        });
    }

    #readMetafileAndObject(id, callback) {
        this.#readMetaFile(id, (err, metadata) => {
            if (err) {
                callback(err);
                return;
            }

            if (!metadata) {
                callback(null, [ null, null ]);
                return;
            }

            const filepath = this.#createObjectFilePath(id);
            const stat = fs.statSync(filepath, { throwIfNoEntry: false });

            if (!stat) {
                this.#logger.debug('object not found', { id, filepath });
                callback(new NotFoundError(`Object "${ id }" not found`, {
                    info: { filepath },
                }));
                return;
            }

            metadata.contentLength = stat.size;

            const readStream = fs.createReadStream(filepath);

            readStream.on('error', (cause) => {
                this.#emitError(new OperationalError(
                    'Encountered read stream error event while reading object',
                    { fatal: true, cause, info: { filepath } }
                ), callback);
            });

            onStreamFinished(readStream, () => {
                readStream.destroy();
            });

            callback(null, [ metadata, readStream ]);
        });
    }

    #writeMetaFile(record, callback) {
        const { id } = record;
        const utf8Data = JSON.stringify(record, null, 2);
        const filepath = this.#createMetaRecordFilePath(id);

        fs.writeFile(filepath, utf8Data, { encoding: 'utf8' }, (cause) => {
            if (cause) {
                callback(new OperationalError(
                    'Encountered file write error while writing object metadata file',
                    { fatal: true, cause, info: { filepath } }
                ));
            } else {
                callback(null, record);
            }
        });
    }

    #readMetaFile(id, callback) {
        const filepath = this.#createMetaRecordFilePath(id);

        fs.readFile(filepath, { encoding: 'utf8' }, (cause, utf8Data) => {
            if (cause) {
                if (cause.code === 'ENOENT') {
                    this.#logger.debug('object metadata file not found', { id, filepath });
                    callback(null, null);
                } else {
                    callback(new OperationalError(
                        'Encountered file read error while reading object metadata file',
                        { fatal: true, cause, info: { filepath } }
                    ));
                }
            } else {
                callback(null, JSON.parse(utf8Data));
            }
        });
    }

    #emitError(error, callback) {
        this.#eventBus.emitEvent(new ErrorEvent(error));
        callback(error);
    }

    #createObjectFilePath(id) {
        return path.join(this.#directory, id);
    }

    #createMetaRecordFilePath(id) {
        return path.join(this.#directory, `${ id }.json`);
    }
}
