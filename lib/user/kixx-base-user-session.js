import KixxBaseModel from '../models/kixx-base-model.js';

export default class KixxBaseUserSession extends KixxBaseModel {

    refresh() {
        const UserSession = this.constructor;

        return new UserSession({
            id: this.id,
            userId: this.userId,
            creationDateTime: this.creationDateTime,
            lastRefreshDateTime: new Date(),
        });
    }

    toRecord() {
        return {
            id: this.id,
            userId: this.userId,
            creationDateTime: this.creationDateTime.toISOString(),
            lastRefreshDateTime: this.lastRefreshDateTime.toISOString(),
        };
    }

    static fromRecord(record) {
        const UserSession = this;

        return new UserSession({
            id: record.id,
            userId: record.userId,
            creationDateTime: new Date(record.creationDateTime),
            lastRefreshDateTime: new Date(record.lastRefreshDateTime),
        });
    }

    static create(props) {
        const UserSession = this;

        return new UserSession({
            id: props.id,
            userId: props.userId,
            creationDateTime: new Date(),
            lastRefreshDateTime: new Date(),
        });
    }
}
