import { assert, assertNonEmptyString } from '../../kixx/assertions/mod.js';

/**
 * Object-store gateway owning private file-content keys and bucket selection.
 * Every attempt lives under `<file UUID>/<generation UUID>`. If a process stops
 * between the object write and document commit or cleanup, operators can list
 * that prefix and remove keys not referenced by the current File record.
 */
export default class FileContentCollection {

    #store;
    #bucket;
    #maxUploadBytes;

    constructor(options) {
        const { store, bucket, maxUploadBytes } = options ?? {};
        assert(store, 'FileContentCollection requires an ObjectStore');
        assertNonEmptyString(bucket, 'FileContentCollection requires a bucket');
        assert(Number.isSafeInteger(maxUploadBytes) && maxUploadBytes >= 0,
            'FileContentCollection requires a nonnegative safe integer maxUploadBytes');
        this.#store = store;
        this.#bucket = bucket;
        this.#maxUploadBytes = maxUploadBytes;
    }

    /** Stores one fresh upload attempt and returns its complete content reference. */
    async create(context, fileId, body, metadata) {
        const { filename, contentType, contentLength } = metadata ?? {};
        assertNonEmptyString(fileId, 'FileContentCollection#create() fileId');
        assertNonEmptyString(filename, 'FileContentCollection#create() filename');
        assertNonEmptyString(contentType, 'FileContentCollection#create() contentType');
        assert(Number.isSafeInteger(contentLength) && contentLength >= 0,
            'FileContentCollection#create() contentLength must be a nonnegative safe integer');
        assert(contentLength <= this.#maxUploadBytes,
            'FileContentCollection#create() contentLength exceeds configured maximum');

        const generation = crypto.randomUUID();
        const key = `${ fileId }/${ generation }`;
        const stored = await this.#store.put(context, this.#bucket, key, body, {
            contentType,
            contentLength,
        });
        return { key, filename, contentType, length: stored.contentLength, etag: stored.etag, generation };
    }

    async get(context, key) {
        return await this.#store.get(context, this.#bucket, key);
    }

    async delete(context, key) {
        await this.#store.delete(context, this.#bucket, key);
    }
}
