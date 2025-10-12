import KixxBaseUser from './kixx-base-user.js';
import KixxRootUser from './kixx-root-user.js';
import KixxBaseUserSession from './kixx-base-user-session.js';
import KixxBaseCollection from '../models/kixx-base-collection.js';

import { assertFunction, assertNonEmptyString } from '../assertions/mod.js';


export default class KixxBaseUserCollection extends KixxBaseCollection {

    // Subclasses can override these models.
    static Model = KixxBaseUser;
    static RootUser = KixxRootUser;
    static UserSession = KixxBaseUserSession;

    constructor(context) {
        super(context);

        assertFunction(this.constructor.RootUser);
        assertFunction(this.constructor.UserSession);

        Object.defineProperties(this, {
            RootUser: {
                enumerable: true,
                value: this.constructor.RootUser,
            },
            UserSession: {
                enumerable: true,
                value: this.constructor.UserSession,
            },
        });
    }

    async getSession(id) {
        const { UserSession } = this;
        const key = this.sessionIdToPrimaryKey(id);
        const doc = await this.datastore.getItem(key);
        return UserSession.fromRecord(doc);
    }

    async refreshSession(session) {
        const newSession = session.refresh();

        const newKey = this.sessionIdToPrimaryKey(newSession.id);
        await this.datastore.setItem(newKey, newSession.toRecord());

        const expiredKey = this.sessionIdToPrimaryKey(session.id);
        await this.datastore.deleteItem(expiredKey);

        return newSession;
    }

    async getUserFromSession(session) {
        assertNonEmptyString(session.userId, `Invalid session.userId passed to ${ this.constructor.name }#getUserFromSession()`);
        const key = this.idToPrimaryKey(session.userId);
        const doc = await this.datastore.getItem(key);
        const ModelConstructor = this.Model;
        return ModelConstructor.fromRecord(doc);
    }

    createRootUser() {
        const { RootUser, context } = this;
        const props = {};
        const roles = [];
        return new RootUser(context, props, roles);
    }

    async createAnonymousUser() {
        const { Model, context } = this;

        const props = { isAnonymous: true };

        const roles = [];
        const role = context.getUserRole('anonymous');
        if (role) {
            roles.push(role);
        }

        const user = Model.create(context, props, roles);
        await this.setItem(user);
        return user;
    }

    sessionIdToPrimaryKey(id) {
        return `${ this.UserSession.name }__${ id }`;
    }
}
