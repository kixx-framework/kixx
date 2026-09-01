import { sortKeyPrefixRange } from '../../kixx/document-store/document-store.js';
import Collection from './base-document-store-collection.js';
import ActivationRecord from './activation-record.js';


export const ACTIVATION_BUILD_INDEX = 'activation_build';
const BUILD_KEY_SEPARATOR = ':';


/**
 * Table Data Gateway for append-only Release activation history.
 * @extends Collection
 */
export default class ActivationCollection extends Collection {

    static TYPE = 'Activation';

    static Record = ActivationRecord;

    static INDEXES = [
        { name: ACTIVATION_BUILD_INDEX, jsonPath: '$.buildActivationKey' },
    ];

    generateSortKey(doc) {
        return doc?.activatedAt;
    }

    /**
     * Appends one activation record.
     * @param {Object} context - Request or execution context.
     * @param {Object} attributes - Activation audit attributes.
     * @returns {Promise<ActivationRecord>} Stored activation.
     */
    async append(context, attributes) {
        const activatedAt = attributes?.activatedAt ?? new Date().toISOString();
        return await this.create(context, Object.assign({}, attributes, {
            activatedAt,
            buildActivationKey: `${ attributes?.buildId }${ BUILD_KEY_SEPARATOR }${ activatedAt }`,
        }));
    }

    /**
     * Returns activation history newest first, optionally restricted to one build.
     * @param {Object} context - Request or execution context.
     * @param {Object} [options] - Pagination and build filter.
     * @param {string} [options.buildId] - Build whose history to list.
     * @param {string|null} [options.cursor] - Opaque pagination cursor.
     * @param {number} [options.limit=100] - Maximum records to return.
     * @returns {Promise<{items: ActivationRecord[], cursor: string|null}>} Activation page.
     */
    async listPage(context, options) {
        const { buildId, cursor, limit } = options ?? {};
        if (!buildId) {
            return await this.scan(context, { descending: true, cursor, limit });
        }

        const prefix = `${ buildId }${ BUILD_KEY_SEPARATOR }`;
        return await this.query(context, {
            index: ACTIVATION_BUILD_INDEX,
            descending: true,
            cursor,
            limit,
            ...sortKeyPrefixRange(prefix),
        });
    }
}
