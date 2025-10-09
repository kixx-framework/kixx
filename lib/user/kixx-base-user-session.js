import KixxBaseModel from '../models/kixx-base-model.js';

export default class KixxBaseUserSession extends KixxBaseModel {
    get ttlSeconds() {
        const ttlMilliseconds = this.expirationDate.getTime() - Date.now();
        return Math.floor(ttlMilliseconds / 1000);
    }

    get isExpired() {
        return new Date() > this.expirationDate;
    }

    canRefresh(slidingWindowSeconds) {
        if (this.isExpired) {
            return false;
        }

        const windowMs = slidingWindowSeconds * 1000;
    }
}
