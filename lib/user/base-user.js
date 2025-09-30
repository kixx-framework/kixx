import { PathToRegexp } from '../vendor/mod.js';
import { UnauthorizedError } from '../errors/mod.js';
import { isNonEmptyString, assert, assertNonEmptyString } from '../assertions/mod.js';


export default class BaseUser {

    static TYPE = '';

    static ROLES = [];

    constructor(context, props = {}) {
        const type = this.constructor.TYPE;

        assert(context, 'A User requires a Context');
        assertNonEmptyString(type, `Invalid .TYPE for User "${ this.constructor.name }"`);

        // Assign user properties first, so we can override naming collisions
        // using Object.defineProperties() next.
        Object.assign(this, props);

        let roles = [];
        if (Array.isArray(this.constructor.ROLES)) {
            roles = this.constructor.ROLES.map((role) => {
                let permissionMatchers = [];

                if (Array.isArray(role?.permissions)) {
                    permissionMatchers = role.permissions
                        .filter((pattern) => {
                            return isNonEmptyString(pattern);
                        })
                        .map((pattern) => {
                            return PathToRegexp.match(pattern);
                        });
                }

                return Object.freeze(Object.assign({}, role, { permissionMatchers }));
            });
        }

        Object.defineProperties(this, {
            context: {
                enumerable: false,
                value: context,
            },
            type: {
                enumerable: true,
                value: type,
            },
            roles: {
                enumerable: true,
                value: Object.freeze(roles),
            },
        });
    }

    hasPermission(permissionURN) {
        for (const role of this.roles) {
            for (const match of role.permissionMatchers) {
                if (match(permissionURN)) {
                    return true;
                }
            }
        }
        return false;
    }

    checkPermission(permissionURN, caller) {
        if (!this.hasPermission(permissionURN)) {
            throw new UnauthorizedError(
                `User type ${ this.type } is not authorized for ${ permissionURN }`,
                null,
                caller
            );
        }
    }

    async getItem(params) {
        assertNonEmptyString(params.view);

        // Will throw an AssertionError if the view does not exist.
        const view = this.context.getView(params.view);

        this.checkPermission(`/view/${ params.view }/getItem/${ params.type }`, this.getItem);

        const res = await view.getItem(params);
        return res;
    }

    async saveFormData(params) {
        assertNonEmptyString(params.form);

        // Will throw an AssertionError if the form does not exist.
        const form = this.context.getForm(params.form);

        this.checkPermission(`/form/${ params.form }/save`, this.saveFormData);

        const res = await form.save(params.data);
        return res;
    }
}
