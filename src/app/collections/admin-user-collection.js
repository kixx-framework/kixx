import { generateShortId } from '../../kixx/utils/crypto.js';
import Collection from './base-document-store-collection.js';
import AdminUserRecord from './admin-user-record.js';


/**
 * Secondary index name used to look up admin users by email address.
 * Registered in DOCUMENT_STORE_INDEXES (app/app.js) against `$.emailAddress`.
 * @type {string}
 */
export const ADMIN_USER_EMAIL_ADDRESS_INDEX = 'admin_user_email_address';


export default class AdminUserCollection extends Collection {

    static TYPE = 'AdminUser';

    static Record = AdminUserRecord;

    // Secondary index definitions owned by this collection. app/app.js collects
    // these into DOCUMENT_STORE_INDEXES so the index name and the jsonPath stay
    // co-located with the query (getByEmailAddress) that depends on them.
    static INDEXES = [
        { name: ADMIN_USER_EMAIL_ADDRESS_INDEX, jsonPath: '$.emailAddress', unique: true },
    ];

    generateUniqueId() {
        return generateShortId();
    }

    generateSortKey(doc) {
        return doc?.userCreationDate;
    }

    /**
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} attributes - New admin user attributes.
     * @param {string[]} [attributes.roles=[]] - Role names granted to the new admin user.
     * @returns {Promise<AdminUserRecord>} The stored admin user record.
     */
    async createNewAdminUser(context, attributes) {
        const userCreationDate = new Date().toISOString();
        // Default missing roles to [] at this create-call boundary (not in
        // AdminUserRecord#validate()) so callers that do not yet assign a
        // role — and any future caller — get an empty-but-valid roles array
        // rather than a validation failure.
        const { roles = [] } = attributes ?? {};
        const attrs = Object.assign({}, attributes, { userCreationDate, roles });
        const item = await this.create(context, attrs);
        return item;
    }

    async getByEmailAddress(context, emailAddress) {
        const { items } = await this.query(context, {
            index: ADMIN_USER_EMAIL_ADDRESS_INDEX,
            equalTo: emailAddress,
            limit: 1,
        });

        return items[0] ?? null;
    }
}
