import KixxBaseUser from './kixx-base-user.js';
import KixxRootUser from './kixx-root-user.js';
import KixxBaseCollection from '../models/kixx-base-collection.js';

export default class KixxBaseUserCollection extends KixxBaseCollection {

    // Subclasses can override the base type.
    static Model = KixxBaseUser;
    static RootUser = KixxRootUser;

    constructor(context) {
        super(context);

        Object.defineProperties(this, {
            RootUser: {
                enumerable: true,
                value: this.constructor.RootUser,
            },
        });
    }

    createRootUser() {
        const { RootUser, context } = this;
        const collection = this;
        const props = {};
        const roles = [];
        return new RootUser(collection, context, props, roles);
    }

    createAnonymousUser() {
    }

    getSession(id) {
    }

    createSession(user) {
    }
}
