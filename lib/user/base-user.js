import { PathToRegexp } from '../vendor/mod.js';
import { UnauthorizedError } from '../errors/mod.js';
import { AssertionError } from '../assertions/mod.js';


export default class BaseUser {

    constructor(role, collections, forms) {
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
            collections: {
                enumerable: true,
                value: collections,
            },
            forms: {
                enumerable: true,
                value: forms,
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
        if (!this.forms.has(formId)) {
            throw new AssertionError(
                `The form "${ formId }" is not registered`,
                null,
                this.saveFormData
            );
        }

        const permissionURN = `/form/${ formId }/save`;
        if (!this.hasPermission(permissionURN)) {
            throw new UnauthorizedError(
                `User role ${ this.role.name } is not authorized for ${ permissionURN }`,
                null,
                this.saveFormData
            );
        }

        const form = this.forms.get(formId);

        const res = await form.save(data);

        return res;
    }
}
