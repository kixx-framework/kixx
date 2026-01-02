// TODO: Remove this file
import { NotFoundError } from '../errors/mod.js';
import KixxBaseUser from './kixx-base-user.js';
import KixxRootUser from './kixx-root-user.js';
import KixxBaseUserSession from './kixx-base-user-session.js';

import { assert, assertFunction, assertNonEmptyString } from '../assertions/mod.js';


export default class KixxBaseUserCollection {

    // Subclasses can override these models.
    static User = KixxBaseUser;
    static RootUser = KixxRootUser;
    static UserSession = KixxBaseUserSession;

    constructor(context) {
        assert(context, `A ${ this.constructor.name } requires a Context`);

        const { User, RootUser, UserSession } = this.constructor;

        assertFunction(User, `Invalid .User for "${ this.constructor.name }"`);
        assertNonEmptyString(User.name, `Invalid .Model.name for "${ this.constructor.name }"`);

        assertFunction(RootUser, `Invalid .RootUser for "${ this.constructor.name }"`);

        assertFunction(UserSession, `Invalid .UserSession for "${ this.constructor.name }"`);
        assertNonEmptyString(UserSession.name, `Invalid .UserSession.name for "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            User: {
                enumerable: true,
                value: User,
            },
            RootUser: {
                enumerable: true,
                value: RootUser,
            },
            UserSession: {
                enumerable: true,
                value: UserSession,
            },
            context: {
                value: context,
            },
        });
    }

    /**
     * Returns the datastore instance for this collection. Subclasses may
     * override the get datastore() getter to
     * choose a different datastore.
     *
     * @returns {Datastore} The datastore service instance
     */
    get datastore() {
        return this.context.getService('kixx.Datastore');
    }

    async getSession(id) {
        const { UserSession } = this;
        const key = this.sessionIdToPrimaryKey(id);
        const doc = await this.datastore.getItem(key);

        if (doc) {
            return UserSession.fromRecord(doc);
        }

        return null;
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

        const { context, User } = this;

        const key = this.userIdToPrimaryKey(session.userId);
        const props = await this.datastore.getItem(key);

        if (!props) {
            throw new NotFoundError(`User not found for session.userId: ${ session.userId }`);
        }

        const roles = props.roles
            .map((roleName) => context.getUserRole(roleName))
            .filter((x) => Boolean(x));

        return User.fromRecord(context, props, roles);
    }

    createRootUser() {
        const { RootUser, context } = this;
        const props = {};
        const roles = [];
        return new RootUser(context, props, roles);
    }

    async createAnonymousUser(props) {
        const { User, context } = this;

        props = Object.assign({ isAnonymous: true }, props);

        const roles = [];
        const role = context.getUserRole('anonymous');
        if (role) {
            roles.push(role);
        }

        const user = User.create(context, props, roles);

        const key = this.userIdToPrimaryKey(user.id);
        await this.datastore.setItem(key, user.toRecord());

        return user;
    }

    async createSessionFromUser(user) {
        assertNonEmptyString(user.id, 'A user must have an id when passed to #createSession()');

        const { UserSession } = this;
        const userId = user.id;

        const session = UserSession.create({ userId });
        const key = this.sessionIdToPrimaryKey(session.id);

        await this.datastore.setItem(key, session.toRecord());

        return session;
    }

    userIdToPrimaryKey(id) {
        return `${ this.User.name }__${ id }`;
    }

    sessionIdToPrimaryKey(id) {
        return `${ this.UserSession.name }__${ id }`;
    }
}
