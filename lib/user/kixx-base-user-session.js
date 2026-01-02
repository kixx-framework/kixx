// TODO: Remove this file
import KixxBaseModel from '../models/kixx-base-model.js';

export default class KixxBaseUserSession extends KixxBaseModel {

    refresh() {
        const UserSession = this.constructor;

        return new UserSession({
            id: UserSession.genId(),
            userId: this.userId,
            creationDateTime: this.creationDateTime,
            lastRefreshDateTime: new Date(),
        });
    }

    toRecord() {
        const record = Object.assign({}, this);

        record.creationDateTime = this.creationDateTime.toISOString();
        record.lastRefreshDateTime = this.lastRefreshDateTime.toISOString();

        return record;
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
            id: UserSession.genId(),
            userId: props.userId,
            creationDateTime: new Date(),
            lastRefreshDateTime: new Date(),
        });
    }
}
