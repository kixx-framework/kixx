import ObjectStoreEngine from './object-store-engine.js';
import LockingQueue from '../lib/locking-queue.js';
import { BadRequestError } from '../errors/mod.js';
import { assert, assertNonEmptyString, isUndefined } from '../assertions/mod.js';


export default class ObjectStore {

    #db = null;
    #lockingQueue = null;

    /**
     * @param {Object} options - Configuration options
     * @param {string} [options.directory] - Directory path for storing data files
     * @param {Object} [options.db] - Optional pre-configured database instance to use
     * @param {Object} [options.lockingQueue] - Optional LockingQueue instance to use
     */
    constructor(options = {}) {
        if (!isUndefined(options.db)) {
            this.#db = options.db;
        } else {
            this.#db = new ObjectStoreEngine({
                logger: options.logger,
                fileSystem: options.fileSystem,
                directory: options.directory,
            });
        }
        if (!isUndefined(options.lockingQueue)) {
            this.#lockingQueue = options.lockingQueue;
        } else {
            this.#lockingQueue = new LockingQueue();
        }
    }

    async getObjectStreamByReference(referenceId) {
        await this.getLock();

        let document;
        let response;
        try {
            document = await this.#db.getObjectMetadata(referenceId);
            if (!document) {
                this.releaseLock();
                return null;
            }

            assertNonEmptyString(document.objectId, 'Object metadata objectId');

            // Returns a source stream and HTTP Headers instance.
            response = await this.#db.getObjectResponse(document.objectId);
        } catch (err) {
            this.releaseLock();
            throw err;
        }

        this.releaseLock();

        assert(response, `No object by id "${ document.objectId }" as referenced by metadata "${ referenceId }"`);

        return response;
    }

    async putObjectStream(sourceStream, headers) {
        await this.getLock();
        const newHeaders = await this.#db.putObjectStream(sourceStream, headers);
        this.releaseLock();
        return newHeaders;
    }

    async putObjectMetadata(objectId, referenceId, document) {
        await this.getLock();

        const headers = await this.#db.getObjectHeaders(objectId);
        if (!headers) {
            throw new BadRequestError(`Saving metadata; object id "${ objectId }" does not exist`);
        }

        await this.#db.putObjectMetadata(objectId, referenceId, document);
        this.releaseLock();
    }

    async getLock() {
        if (this.#lockingQueue) {
            await this.#lockingQueue.getLock();
        }
    }

    releaseLock() {
        if (this.#lockingQueue) {
            this.#lockingQueue.releaseLock();
        }
    }
}
