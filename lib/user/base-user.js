import { PathToRegexp } from '../vendor/mod.js';
import { UnauthorizedError } from '../errors/mod.js';
import { assertNonEmptyString } from '../assertions/mod.js';


export default class BaseUser {

    constructor(role, context) {
        role = role || {};

        let permissionMatchers = [];
        if (Array.isArray(role.permissions)) {
            permissionMatchers = role.permissions.map((pattern) => {
                return PathToRegexp.match(pattern);
            });
        }

        role = Object.assign(role, {
            permissionMatchers: Object.freeze(permissionMatchers),
        });

        Object.defineProperties(this, {
            role: {
                enumerable: true,
                value: Object.freeze(role),
            },
            context: {
                enumerable: true,
                value: context,
            },
        });
    }

    hasPermission(permissionURN) {
        for (const match of this.role.permissionMatchers) {
            if (match(permissionURN)) {
                return true;
            }
        }
        return false;
    }

    async getItem(params) {
        assertNonEmptyString(params.view);
        assertNonEmptyString(params.type);
        assertNonEmptyString(params.id);

        // Will throw an AssertionError if the view does not exist.
        const view = this.context.getView(params.view);

        const permissionURN = `/view/${ params.view }/getItem/${ params.type }`;
        if (!this.hasPermission(permissionURN)) {
            throw new UnauthorizedError(
                `User role ${ this.role.name } is not authorized for ${ permissionURN }`,
                null,
                this.getItem
            );
        }

        const res = await view.getItem(params);
        return res;
    }

    async saveFormData(params) {
        assertNonEmptyString(params.form);

        // Will throw an AssertionError if the form does not exist.
        const form = this.context.getForm(params.form);

        const permissionURN = `/form/${ params.form }/save`;
        if (!this.hasPermission(permissionURN)) {
            throw new UnauthorizedError(
                `User role ${ this.role.name } is not authorized for ${ permissionURN }`,
                null,
                this.saveFormData
            );
        }

        const res = await form.save(params.data);
        return res;
    }
}
