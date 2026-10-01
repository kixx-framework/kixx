import { assert, isNonEmptyString, isPlainObject, isUndefined } from '../../../../kixx/assertions/mod.js';
import { BadRequestError, ConflictError, ForbiddenError, ValidationError } from '../../../../kixx/errors/mod.js';
import { withErrorSource } from '../../lib/json-api.js';


// Top-level and resource object members this API reads. Everything else the
// JSON:API specification defines (included, relationships, lid, links) is a
// feature the API does not support, so it is rejected rather than ignored.
const DOCUMENT_MEMBERS = new Set([ 'data', 'meta', 'jsonapi' ]);
const RESOURCE_MEMBERS = new Set([ 'type', 'id', 'attributes', 'meta' ]);


/**
 * Validates a JSON:API document and restricts its attributes to those accepted
 * by one operation of a resource registration.
 *
 * The registration's write list is the whole contract: an undeclared or
 * read-only attribute is a field error rather than something silently
 * dropped or blindly merged into a Record. Attribute values themselves are
 * validated later by the Record, which owns their invariants.
 */
export default class AdminDataRecordForm {

    #document;

    /**
     * @param {Object} args - Untrusted document and the operation contract.
     * @param {*} args.document - JSON:API request document.
     * @param {Object} args.resource - Frozen resource registration.
     * @param {string} args.action - `create` or `update`.
     * @param {string} [args.id] - Expected resource id from the URL for updates.
     */
    constructor(args) {
        const { document, resource, action, id } = args ?? {};

        assert(
            action === 'create' || action === 'update',
            'AdminDataRecordForm: action must be create or update',
        );

        this.#document = document;
        this.type = resource.type;
        this.id = id;
        this.resource = resource;
        this.action = action;
    }

    /**
     * Validates document structure, identity, version, then writable attribute names.
     * @returns {void}
     * @throws {BadRequestError} When the document shape or update version is invalid.
     * @throws {ConflictError} When the document type or id differs from the URL.
     * @throws {ForbiddenError} When a create supplies a client-generated id.
     * @throws {ValidationError} When an attribute is undeclared or read-only, or a required create attribute is missing. Each entry's source is the attribute name.
     */
    validate() {
        const document = this.#document;
        const { type, id, action } = this;

        if (!isPlainObject(document)) {
            throw invalidDocument('The request body must be a JSON:API document object.', '');
        }
        rejectUnsupportedMembers(document, DOCUMENT_MEMBERS, '');

        const { data } = document;

        if (!isPlainObject(data)) {
            throw invalidDocument('data must be a resource object.', '/data');
        }
        rejectUnsupportedMembers(data, RESOURCE_MEMBERS, '/data');

        if (!isNonEmptyString(data.type)) {
            throw invalidDocument('data.type must be a non-empty string.', '/data/type');
        }
        if (data.type !== type) {
            throw withErrorSource(new ConflictError(
                'data.type does not match the resource type in the URL.',
                { code: 'JsonApiResourceTypeMismatch' },
            ), { pointer: '/data/type' });
        }

        if (action === 'create') {
            // Ids are server-generated, and JSON:API 1.1 answers an unsupported
            // client-generated id with 403.
            if (Object.hasOwn(data, 'id')) {
                throw withErrorSource(new ForbiddenError(
                    'Client-generated ids are not supported.',
                    { code: 'JsonApiClientIdNotSupported' },
                ), { pointer: '/data/id' });
            }

            if (!isPlainObject(data.attributes)) {
                throw invalidDocument('data.attributes must be an object.', '/data/attributes');
            }
        } else {
            if (!isNonEmptyString(data.id)) {
                throw invalidDocument('data.id must be a non-empty string.', '/data/id');
            }
            if (data.id !== id) {
                throw withErrorSource(new ConflictError(
                    'data.id does not match the resource id in the URL.',
                    { code: 'JsonApiResourceIdMismatch' },
                ), { pointer: '/data/id' });
            }
            if (!isUndefined(data.attributes) && !isPlainObject(data.attributes)) {
                throw invalidDocument('data.attributes must be an object.', '/data/attributes');
            }

            this.version = readBodyVersion(data.meta);
        }

        if (!isUndefined(data.meta) && !isPlainObject(data.meta)) {
            throw invalidDocument('data.meta must be an object.', '/data/meta');
        }

        this.attributes = data.attributes ?? {};

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
     * Creates a form from the complete JSON:API document. Call validate() before toJSON().
     * @param {*} document - Untrusted JSON:API request document.
     * @param {Object} resource - Frozen resource registration.
     * @param {string} action - `create` or `update`.
     * @param {string} [id] - Expected resource id from the URL for updates.
     * @returns {AdminDataRecordForm} Form awaiting validation.
     */
    static fromJsonApi(document, resource, action, id) {
        return new AdminDataRecordForm({ document, resource, action, id });
    }
}

function readBodyVersion(meta) {
    const version = isPlainObject(meta) ? meta.version : undefined;

    if (!Number.isSafeInteger(version) || version <= 0) {
        throw withErrorSource(new BadRequestError(
            'data.meta.version must be the positive integer version last read.',
            { code: 'AdminDataInvalidVersion' },
        ), { pointer: '/data/meta/version' });
    }

    return version;
}

function rejectUnsupportedMembers(object, allowedMembers, pointer) {
    for (const name of Object.keys(object)) {
        if (!allowedMembers.has(name)) {
            // RFC 6901: escape "~" before "/" so an escaped "/" is not re-escaped.
            const segment = name.replaceAll('~', '~0').replaceAll('/', '~1');
            throw invalidDocument(`The '${ name }' member is not supported.`, `${ pointer }/${ segment }`);
        }
    }
}

function invalidDocument(message, pointer) {
    return withErrorSource(new BadRequestError(message, { code: 'JsonApiInvalidDocument' }), { pointer });
}
