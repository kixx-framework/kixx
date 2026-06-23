import { generateShortId } from '../../kixx/utils/crypto.js';
import Collection from './base-document-store-collection.js';
import AdminUserRecord from './admin-user-record.js';


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
}
