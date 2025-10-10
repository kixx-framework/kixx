import KixxBaseModel from '../models/kixx-base-model.js';

export default class KixxBaseUserSession extends KixxBaseModel {

    get ttlSeconds() {
        const ttlMilliseconds = this.expirationDate.getTime() - Date.now();
        return Math.floor(ttlMilliseconds / 1000);
    }

    get isExpired() {
    }

    /**
     * The session supports a refresh, and the current datetime is within
     * the valid refresh window.
     * @param  {[type]} slidingWindowSeconds [description]
     * @return {[type]}                      [description]
     */
    shouldRefresh(slidingWindowSeconds) {
        if (this.isExpired) {
            return false;
        }

        const windowMs = slidingWindowSeconds * 1000;
    }

    toRecord() {
        const { id, userId } = this;

        const creationDateTime = this.creationDateTime
            ? this.creationDateTime.toISOString()
            : null;

        const expirationDateTime = this.expirationDateTime
            ? this.expirationDateTime.toISOString()
            : null;

        return {
            id,
            userId,
            creationDateTime,
            expirationDateTime,
        };
    }

    static fromRecord(record) {
        const UserSession = this;

        const creationDateTime = record.creationDateTime
            ? new Date(record.creationDateTime)
            : null;

        const expirationDateTime = record.expirationDateTime
            ? new Date(record.expirationDateTime)
            : null;

        return new UserSession({
            id: record.id,
            userId: record.userId,
            creationDateTime,
            expirationDateTime,
        });
    }
}
