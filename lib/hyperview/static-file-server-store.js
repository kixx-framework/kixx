import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as fileSystem from '../lib/file-system.js';
import { getContentTypeForFileExtension } from '../lib/http-utils.js';


export class File {

    #filepath = null;
    #stats = null;
    #fileSystem = null;

    constructor(config) {
        this.#filepath = config.filepath;
        this.#stats = config.stats;
        this.#fileSystem = config.fileSystem;
    }

    get sizeBytes() {
        return this.#stats.size;
    }

    get modifiedDate() {
        return this.#stats.mtime;
    }

    get contentType() {
        return getContentTypeForFileExtension(path.extname(this.#filepath));
    }

    async computeHash() {
        const fileInputStream = this.createReadStream();
        const hash = crypto.createHash('md5');

        const hex = await pipeline(fileInputStream, hash.setEncoding('hex'));
        return hex;
    }

    createReadStream() {
        return this.#fileSystem.createReadStream(this.#filepath);
    }
}

export default class StaticFileServerStore {

    #publicDirectory = null;
    #fileSystem = null;

    constructor(options) {
        options = options || {};

        this.#publicDirectory = options.publicDirectory;
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    async getFile(pathname) {
        const parts = pathname.split('/');
        const filepath = path.join(this.#publicDirectory, ...parts);

        const stats = await this.#fileSystem.getFileStats(filepath);

        if (!stats || !stats.isFile()) {
            return null;
        }

        return new File({
            fileSystem: this.#fileSystem,
            filepath,
            stats,
        });
    }
}
