import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WrappedError } from '../errors/mod.js';
import { assert } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


export default class ObjectStoreEngine {

    #logger = null;
    #fs = null;

    constructor(options) {
        this.#logger = options.logger;
        this.#fs = options.fileSystem || fileSystem;
        this.directory = options.directory;
    }

    async getObjectResponse(objectId) {
        const headersFilepath = this.objectIdToHeadersFilePath(objectId);
        const headers = await this.#fs.readJSONFile(headersFilepath);

        if (!headers) {
            this.#logger.debug('headers file not found', {
                objectId,
                filepath: headersFilepath,
            });
            return null;
        }

        const filepath = this.objectIdToFilePath(objectId);
        const stream = this.#fs.createReadStream(filepath, { encoding: null });

        if (!stream) {
            this.#logger.debug('object file not found', { objectId, filepath });
            return null;
        }

        stream.headers = new Headers(headers);
        return stream;
    }

    async putObjectStream(sourceStream, headers) {
        const objectMeta = await this.writeStreamToTemporaryFile(sourceStream);
        const id = objectMeta.md5ChecksumHex;

        const filepath = this.objectIdToFilePath(id);
        const stats = await this.#fs.getFileStats(filepath);

        // TODO: Validate the Content-Length and, optionally, the md5 hash and/or stop the stream
        //       after reaching the expected content length. This is to
        //       prevent someone from sending a very large file and writing it to disk.

        if (stats) {
            // The object already exists; returning existing headers.
            const headersFilepath = this.objectIdToHeadersFilePath(id);
            const existingHeaders = await this.#fs.readJSONFile(headersFilepath);

            assert(existingHeaders, `Object headers file for "${ id }" at ${ headersFilepath }`);

            return new Headers(existingHeaders);
        }

        await this.#fs.rename(objectMeta.filepath, filepath);

        return new Headers({
            'Content-Type': headers.get('Content-Type'),
            'Content-Length': objectMeta.contentLength.toString(),
            'Etag': id,
            'Last-Modified': new Date().toUTCString(),
        });
    }

    objectIdToFilePath(objectId) {
        return path.join(this.directory, objectId);
    }

    objectIdToHeadersFilePath(objectId) {
        return path.join(this.directory, `${ objectId }_stats.json`);
    }

    writeStreamToTemporaryFile(sourceStream) {
        return new Promise((resolve, reject) => {
            let contentLength = 0;

            const hasher = crypto.createHash('md5');

            const filepath = this.createTemporaryFilepath();
            const writeStream = this.#fs.createWriteStream(filepath, { encoding: null });

            sourceStream.on('error', (cause) => {
                this.#logger.warn('object source stream error event', { filepath }, cause);
                reject(new WrappedError(
                    `Object source stream error event while writing tempory scratch file ${ filepath }`,
                    { cause },
                    this.writeStreamToTemporaryFile
                ));
            });

            writeStream.on('error', (cause) => {
                this.#logger.warn('object write stream error event', { filepath }, cause);
                reject(new WrappedError(
                    `Object write stream error event while writing tempory scratch file ${ filepath }`,
                    { cause },
                    this.writeStreamToTemporaryFile
                ));
            });

            sourceStream.on('data', (chunk) => {
                contentLength += chunk.length;
                hasher.update(chunk);
            });

            sourceStream.on('end', (chunk) => {
                if (chunk) {
                    contentLength += chunk.length;
                    hasher.update(chunk);
                }

                // Get the hash as a buffer by not passing in a string encoding (hex or base64).
                // This allows the caller to get the string encoding needed.
                const md5Hash = hasher.digest();

                resolve({
                    filepath,
                    contentLength,
                    md5ChecksumHex: md5Hash.toString('hex'),
                    md5ChecksumBase64: md5Hash.toString('base64'),
                });
            });


            sourceStream.pipe(writeStream);
        });
    }

    createTemporaryFilepath() {
        const filename = `kixx_object_${ crypto.randomUUID() }`;
        return path.join(os.tmpdir(), filename);
    }
}
