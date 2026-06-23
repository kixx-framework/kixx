import { generateShortId } from '../../kixx/utils/crypto.js';
import Collection from './base-key-value-store-collection.js';
import UserSessionRecord from './user-session-record.js';


export default class UserSessionCollection extends Collection {

    static TYPE = 'UserSession';

    static Record = UserSessionRecord;

    generateUniqueId() {
        return generateShortId();
    }
}
