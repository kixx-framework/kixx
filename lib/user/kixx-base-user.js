import crypto from 'node:crypto';
import { UnauthorizedError } from '../errors/mod.js';
import { assert, assertNonEmptyString } from '../assertions/mod.js';


export default class KixxBaseUser {

    constructor(context, props, roles) {
        assert(context, 'A User requires a Context');

        this.assignProps(props);

        Object.defineProperties(this, {
            context: {
                enumerable: false,
                value: context,
            },
            type: {
                enumerable: true,
                value: this.constructor.name,
            },
            roles: {
                enumerable: true,
                value: Object.freeze(roles),
            },
            isAnonymous: {
                enumerable: true,
                value: Boolean(props.isAnonymous),
            },
        });
    }

    assignProps(props) {
        Object.assign(this, props);
        return this;
    }

    hasPermission(permissionURN) {
        for (const role of this.roles) {
            for (const { regex } of role.permissions) {
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

        const urn = `kixx:view:${ params.view }:getItem:${ params.type || '' }`;

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

    toRecord() {
        const record = Object.assign({}, this);

        record.roles = this.roles.map(({ name }) => {
            assertNonEmptyString(name, 'A user role must have a name');
            return name;
        });

        return record;
    }

    static genId() {
        return crypto.randomUUID();
    }

    static fromRecord(context, props, roles) {
        const Model = this;
        return new Model(context, props, roles);
    }

    static create(context, props, roles) {
        const Model = this;
        const id = Model.genId();
        props = Object.assign({ id }, props);
        return new Model(context, props, roles);
    }
}
