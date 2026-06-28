import { generateSecretToken } from '../../kixx/utils/crypto.js';
import Collection from './base-key-value-store-collection.js';
import UserSessionRecord from './user-session-record.js';


export default class UserSessionCollection extends Collection {

    static TYPE = 'UserSession';

    static Record = UserSessionRecord;

    generateUniqueId() {
        return generateSecretToken();
    }

    async createForUser(context, userId, ttlSeconds) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = nowSeconds + ttlSeconds;
        const expirationDate = new Date(expiresAt * 1000);

        const session = {
            userId,
            sessionCreationDate: new Date().toISOString(),
            sessionExpirationDate: expirationDate.toISOString(),
        };

        return await this.put(context, session, { expiresAt });
    }
}
