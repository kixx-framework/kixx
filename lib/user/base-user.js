import { PathToRegexp } from '../vendor/mod.js';
import { UnauthorizedError } from '../errors/mod.js';


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

    async saveFormData(formId, data) {
        // Will throw an AssertionError if the form does not exist.
        const form = this.context.getForm(formId);
        const permissionURN = `/form/${ formId }/save`;
        if (!this.hasPermission(permissionURN)) {
            throw new UnauthorizedError(
                `User role ${ this.role.name } is not authorized for ${ permissionURN }`,
                null,
                this.saveFormData
            );
        }

        const res = await form.save(data);

        return res;
    }
}
