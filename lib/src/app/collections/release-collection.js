import Collection from './base-document-store-collection.js';
import ReleaseRecord from './release-record.js';


/**
 * Table Data Gateway for immutable Release audit metadata.
 * @extends Collection
 */
export default class ReleaseCollection extends Collection {

    static TYPE = 'Release';

    static Record = ReleaseRecord;

    generateUniqueId(attributes) {
        return attributes.releaseId;
    }

    generateSortKey(doc) {
        return doc?.createdAt;
    }

    /**
     * Returns Releases newest first using stable keyset pagination.
     * @param {Object} context - Request or execution context.
     * @param {Object} [options] - Pagination options.
     * @returns {Promise<{items: ReleaseRecord[], cursor: string|null}>} Release page.
     */
    async listPage(context, options) {
        const { cursor, limit } = options ?? {};
        return await this.scan(context, { descending: true, cursor, limit });
    }
}
