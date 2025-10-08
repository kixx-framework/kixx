import KixxBaseModel from '../models/kixx-base-model.js';
import { UnauthorizedError } from '../errors/mod.js';
import { assert, assertNonEmptyString } from '../assertions/mod.js';


export default class KixxBaseUser extends KixxBaseModel {

    constructor(collection, context, props, roles) {
        super(collection, props);

        assert(context, 'A User requires a Context');

        Object.defineProperties(this, {
            context: {
                enumerable: false,
                value: context,
            },
            roles: {
                enumerable: true,
                value: roles,
            },
        });
    }

    hasPermission(permissionURN) {
        for (const role of this.roles) {
            for (const regex of role.permissionMatchers) {
                if (regex.test(permissionURN)) {
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

        const urn = `kixx:view:${ params.view || '' }:getItem:${ params.type || '' }`;

        this.checkPermission(urn, this.getItem);

        const res = await view.getItem(params);
        return res;
    }

    async saveFormData(params) {
        assertNonEmptyString(params.form);

        // Will throw an AssertionError if the form does not exist.
        const form = this.context.getForm(params.form);

        const urn = `kixx:form:${ params.form }:save`;

        this.checkPermission(urn, this.saveFormData);

        const res = await form.save(params.data);
        return res;
    }
}
