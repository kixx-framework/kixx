import {
    AssertionError,
    ConflictError,
    ForbiddenError,
    MethodNotAllowedError,
    NotFoundError,
} from '../../../kixx/errors/mod.js';
import { assert, isNonEmptyString, isUndefined } from '../../../kixx/assertions/mod.js';
import { adminDataResources } from '../../admin-data-api/mod.js';


// The document store treats a control character in an id as a programmer
// error. Ids here arrive from URLs, so screen them first: no stored record can
// have such an id, which makes "not found" the truthful answer.
const CONTROL_CHAR_PATTERN = /[\x00-\x1F]/; // eslint-disable-line no-control-regex

/**
 * @typedef {Object} AdminDataRecord
 * @property {string} type - Public JSON:API resource type.
 * @property {string} id - Record id.
 * @property {number} version - Store version the client must echo on writes.
 * @property {string} createdAt - ISO 8601 creation time.
 * @property {string} updatedAt - ISO 8601 last-write time.
 * @property {Object} attributes - Declared attributes only; never storage metadata or undeclared fields.
 */


/**
 * Resolves the registration for a type and verifies that the authenticated
 * principal may perform an action on it.
 *
 * Every administrative data script calls this first, so authorization does
 * not depend on the HTTP layer having checked already.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {string} type - Public JSON:API resource type.
 * @param {string} action - One of `list`, `get`, `create`, `update`, or `delete`.
 * @returns {Object} The frozen resource registration.
 * @throws {NotFoundError} With code `AdminDataResourceTypeNotFound` when the type is not registered.
 * @throws {MethodNotAllowedError} With code `AdminDataOperationNotEnabled` when the registration does not enable the action.
 * @throws {ForbiddenError} With code `AdminDataActionNotGranted` when the token does not grant the action on the Collection.
 */
export function authorizeAdminDataAction(context, type, action) {
    const resource = adminDataResources.getResource(type);

    if (!resource) {
        throw new NotFoundError('Unknown resource type.', { code: 'AdminDataResourceTypeNotFound' });
    }

    if (!adminDataResources.isOperationEnabled(type, action)) {
        throw new MethodNotAllowedError(
            `The ${ action } operation is not enabled for this resource type.`,
            { code: 'AdminDataOperationNotEnabled' },
        );
    }

    // Grants come only from the token (see authenticate-admin-data-api-token.js);
    // a principal without permissions is denied rather than treated as a bug,
    // because the registry is the authority on what any grant means.
    const permissions = context.user?.permissions ?? [];

    if (!adminDataResources.isAuthorized(permissions, type, action)) {
        throw new ForbiddenError(
            `This token is not granted ${ action } on this resource type.`,
            { code: 'AdminDataActionNotGranted' },
        );
    }

    return resource;
}

/**
 * Loads one record by id, treating ids no record can have as absent.
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context.
 * @param {Object} collection - Collection named by the registration.
 * @param {string} id - Record id from the request.
 * @returns {Promise<Object|null>} The Record, or null when absent.
 * @throws {AssertionError} When the store fails unexpectedly.
 */
export async function findRecord(context, collection, id) {
    if (!isNonEmptyString(id) || CONTROL_CHAR_PATTERN.test(id)) {
        return null;
    }

    try {
        return await collection.get(context, id);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin data record', { cause });
    }
}

/**
 * Loads a record that a mutation requires, and verifies the version the
 * client last observed.
 *
 * The comparison happens before any write so a stale client is told
 * immediately; the write itself is still conditional on the same version, so
 * a writer that slips in after this load is caught by the store.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context.
 * @param {Object} collection - Collection named by the registration.
 * @param {string} id - Record id from the request.
 * @param {number} version - Version the client observed.
 * @returns {Promise<Object>} The loaded Record at exactly `version`.
 * @throws {NotFoundError} With code `AdminDataRecordNotFound` when the record is absent.
 * @throws {ConflictError} With code `AdminDataVersionConflict` when the stored version differs.
 */
export async function requireRecordAtVersion(context, collection, id, version) {
    assert(Number.isSafeInteger(version) && version > 0, 'requireRecordAtVersion: version must be a positive integer');

    const record = await findRecord(context, collection, id);

    if (!record) {
        throw recordNotFoundError();
    }

    if (record.version !== version) {
        throw versionConflictError();
    }

    return record;
}

/**
 * Translates a Collection write failure into the API's documented errors.
 *
 * Record validation failures pass through unchanged so their per-field
 * sources reach the client. Anything unrecognized is a bug, never a client
 * error.
 *
 * @param {Error} cause - Error thrown by a Collection write.
 * @returns {Error} The error to throw.
 */
export function translateWriteError(cause) {
    if (cause.name === 'ValidationError') {
        return cause;
    }
    if (cause.name === 'VersionConflictError') {
        return versionConflictError(cause);
    }
    if (cause.name === 'DocumentNotFoundError') {
        return recordNotFoundError(cause);
    }
    if (cause.name === 'DocumentUniqueIndexViolationError') {
        return new ConflictError('The change conflicts with another record.', {
            cause,
            code: 'AdminDataUniqueConflict',
        });
    }
    return new AssertionError('Unexpected error while writing an admin data record', { cause });
}

/**
 * Projects a Record onto its registration's declared attributes.
 *
 * Only declared attributes are copied, and each is cloned, so undeclared
 * stored fields, sort keys, and later mutation of the Record never reach the
 * response.
 *
 * @param {Object} resource - Frozen resource registration.
 * @param {Object} record - Record loaded or returned by the Collection.
 * @returns {AdminDataRecord} Plain projected record.
 */
export function projectRecord(resource, record) {
    const attributes = {};

    for (const name of Object.keys(resource.attributes)) {
        const value = record.get(name);

        if (!isUndefined(value)) {
            attributes[name] = structuredClone(value);
        }
    }

    return {
        type: resource.type,
        id: record.id,
        version: record.version,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        attributes,
    };
}

/**
 * Asserts that attributes were already restricted to the operation's
 * writable list. The presentation Form reports violations to the client;
 * reaching here with one is a wiring bug.
 * @param {string[]} writable - Attribute names the operation accepts.
 * @param {Object} attributes - Attributes about to be persisted.
 * @returns {void}
 * @throws {AssertionError} When an attribute is not writable.
 */
export function assertWritableAttributes(writable, attributes) {
    for (const name of Object.keys(attributes)) {
        assert(writable.includes(name), `admin data write: attribute '${ name }' is not writable`);
    }
}

function recordNotFoundError(cause) {
    return new NotFoundError('Record not found.', { cause, code: 'AdminDataRecordNotFound' });
}

function versionConflictError(cause) {
    return new ConflictError(
        'The record has changed since the supplied version. Read it again and retry.',
        { cause, code: 'AdminDataVersionConflict' },
    );
}
