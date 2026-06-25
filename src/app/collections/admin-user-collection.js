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

    generateUniqueId() {
        return generateShortId();
    }

    generateSortKey(doc) {
        return doc?.userCreationDate;
    }

    async createNewAdminUser(context, attributes) {
        const userCreationDate = new Date().toISOString();
        const attrs = Object.assign({}, attributes, { userCreationDate });
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
