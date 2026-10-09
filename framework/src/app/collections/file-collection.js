import Collection from './base-document-store-collection.js';
import FileRecord from './file-record.js';
import { assertNonEmptyString } from '../../kixx/assertions/mod.js';

/** Document-store gateway for stable file identities. */
export default class FileCollection extends Collection {

    static TYPE = 'File';
    static Record = FileRecord;

    /** Creates a file with an immutable upload-order key. */
    async createFile(context, attributes) {
        const id = attributes.id;
        assertNonEmptyString(id, 'FileCollection#createFile() attributes.id');
        const originalUploadedAt = new Date().toISOString();
        return await this.create(context, Object.assign({}, attributes, {
            id,
            originalUploadedAt,
            sortKey: `${ originalUploadedAt }:${ id }`,
        }));
    }

    /** Returns a newest-first page with the fixed file-library page size. */
    async listPage(context, cursor) {
        return await this.scan(context, { descending: true, cursor, limit: 25 });
    }

    /** Applies only the supplied fields across bounded optimistic retries. */
    async patch(context, record, patch) {
        record.merge(patch);
        return await this.updateWithRetry(context, record, (latest) => latest.merge(patch));
    }

    /** Loads a file while asserting the internal identifier contract. */
    async getFile(context, id) {
        assertNonEmptyString(id, 'FileCollection#getFile() id');
        return await this.get(context, id);
    }
}
