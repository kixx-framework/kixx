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
     * Derives the document id from the assignment this activation records.
     *
     * One committed assignment mints exactly one `assignmentId`, so this id is
     * stable across repeated appends for the same assignment.
     *
     * @param {Object} attributes - Prepared activation attributes.
     * @returns {string} Derived document id.
     */
    generateUniqueId(attributes) {
        return `${ attributes?.buildId }${ BUILD_KEY_SEPARATOR }${ attributes?.assignmentId }`;
    }

    /**
     * Appends one activation record, idempotently per assignment.
     *
     * Both `buildId` and `assignmentId` are required: together they derive the
     * document id, so a repeated append for the same assignment overwrites its
     * own row rather than adding a duplicate. `activatedAt` must come from the
     * committed assignment rather than a wall clock, because it is also the
     * sort key and the build index key.
     *
     * @param {Object} context - Request or execution context.
     * @param {Object} attributes - Activation audit attributes.
     * @returns {Promise<ActivationRecord>} Stored activation.
     * @throws {ValidationError} When the audit attributes are incomplete or invalid.
     */
    async append(context, attributes) {
        return await this.put(context, Object.assign({}, attributes, {
            buildActivationKey: `${ attributes?.buildId }${ BUILD_KEY_SEPARATOR }${ attributes?.activatedAt }`,
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
