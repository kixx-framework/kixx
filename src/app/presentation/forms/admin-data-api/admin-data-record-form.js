import { assert, isPlainObject } from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';


/**
 * Restricts a parsed JSON:API resource to the attributes one operation of a
 * resource registration accepts.
 *
 * The registration's write list is the whole contract: an undeclared or
 * read-only attribute is a field error rather than something silently
 * dropped or blindly merged into a Record. Attribute values themselves are
 * validated later by the Record, which owns their invariants.
 */
export default class AdminDataRecordForm {

    /**
     * @param {Object} args - Parsed resource values and the operation contract.
     * @param {string} args.type - Public JSON:API resource type.
     * @param {string} [args.id] - Record id; present for updates.
     * @param {number} [args.version] - Observed record version; present for updates.
     * @param {Object} args.attributes - Attributes from the request document.
     * @param {Object} args.resource - Frozen resource registration.
     * @param {string} args.action - `create` or `update`.
     */
    constructor(args) {
        const {
            type,
            id,
            version,
            attributes,
            resource,
            action,
        } = args ?? {};

        assert(isPlainObject(attributes), 'AdminDataRecordForm: attributes must be a plain object');
        assert(
            action === 'create' || action === 'update',
            'AdminDataRecordForm: action must be create or update',
        );

        this.type = type;
        this.id = id;
        this.version = version;
        this.attributes = attributes;
        this.resource = resource;
        this.action = action;
    }

    /**
     * Validates attribute names against the operation contract.
     * @returns {void}
     * @throws {ValidationError} When an attribute is undeclared or read-only, or a required create attribute is missing. Each entry's source is the attribute name.
     */
    validate() {
        const error = new ValidationError('The resource contains attributes this operation does not accept');
        const operation = this.resource.operations[this.action];

        for (const name of Object.keys(this.attributes)) {
            if (!Object.hasOwn(this.resource.attributes, name)) {
                error.push(`'${ name }' is not an attribute of ${ this.type }`, name);
            } else if (!operation.attributes.includes(name)) {
                error.push(`'${ name }' cannot be written by ${ this.action }`, name);
            }
        }

        for (const name of operation.required ?? []) {
            if (!Object.hasOwn(this.attributes, name)) {
                error.push(`'${ name }' is required`, name);
            }
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns the values consumed by the administrative data Transaction Scripts.
     * @returns {{ type: string, id: string|undefined, version: number|undefined, attributes: Object }} Plain form values.
     */
    toJSON() {
        return {
            type: this.type,
            id: this.id,
            version: this.version,
            attributes: this.attributes,
        };
    }

    /**
     * Creates the form from a resource parsed by the admin data protocol parser.
     * @param {{ type: string, id?: string, version?: number, attributes: Object }} parsed - Parsed resource values.
     * @param {Object} resource - Frozen resource registration.
     * @param {string} action - `create` or `update`.
     * @returns {AdminDataRecordForm} Hydrated form.
     */
    static fromJsonApi(parsed, resource, action) {
        return new AdminDataRecordForm(Object.assign({}, parsed, { resource, action }));
    }
}
