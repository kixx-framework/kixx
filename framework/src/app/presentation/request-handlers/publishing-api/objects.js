import { BadRequestError, OperationalError, PayloadTooLargeError, ValidationError } from '../../../../kixx/errors/mod.js';
import { hashBlob, isValidHash } from '../../../../kixx/content-addressable-store/addressing.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { MAX_OBJECT_BYTES, MAX_OBJECT_STATUS_IDS } from './constants.js';


/**
 * Reports which deduplicated object ids are stored and their sizes.
 * @param {Object} context - Active request context.
 * @param {Object} request - JSON:API ObjectStatus request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API object resource collection.
 */
export async function getObjectStatus(context, request, response) {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'ObjectStatus');
    const objectIds = validateObjectIds(attributes.objectIds);
    const store = context.getService('ContentAddressableStore');
    const stats = await store.statObjects(context, objectIds);
    const data = [];

    objectIds.forEach((objectId, index) => {
        if (stats[index]) {
            data.push({
                type: 'Object',
                id: objectId,
                attributes: { size: stats[index].size },
            });
        }
    });

    return response.respondWithJSON(200, { data }, { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Stores raw bytes only when they match the object id in the route.
 * @param {Object} context - Active request context.
 * @param {Object} request - Raw object upload request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API Object response.
 * @throws {ValidationError} When the route id does not match the payload bytes.
 * @throws {OperationalError} With status 411 when Content-Length is missing.
 * @throws {PayloadTooLargeError} When Content-Length exceeds the object size limit.
 */
export async function putObject(context, request, response) {
    const objectId = request.pathnameParams.objectId;
    if (!isValidHash(objectId)) {
        throw validationError('Object id must be a valid content address', 'ObjectIdInvalid', 'objectId');
    }

    if (!request.headers.has('content-length')) {
        throw new OperationalError('Object uploads require Content-Length.', {
            expected: true,
            httpStatusCode: 411,
            code: 'LengthRequired',
            name: 'LengthRequiredError',
        });
    }

    // Trust the declared length; body reading and storage enforce platform limits.
    const declaredLength = Number.parseInt(request.headers.get('content-length'), 10);
    if (declaredLength > MAX_OBJECT_BYTES) {
        throw new PayloadTooLargeError(`Request body exceeds the maximum of ${ MAX_OBJECT_BYTES } bytes.`);
    }

    const payload = await request.arrayBuffer();
    const actualObjectId = await hashBlob(payload);

    if (actualObjectId !== objectId) {
        throw validationError('Uploaded bytes do not match the object id', 'ObjectIdMismatch', 'objectId');
    }

    const store = context.getService('ContentAddressableStore');
    const [ existing ] = await store.statObjects(context, [ objectId ]);
    const result = existing
        ? { objectId, size: existing.size }
        : await store.putObject(context, payload);

    const document = {
        data: {
            type: 'Object',
            id: objectId,
            attributes: { size: result.size },
        },
    };
    return response.respondWithJSON(existing ? 200 : 201, document, { contentType: JSON_API_CONTENT_TYPE });
}

function validateObjectIds(value) {
    if (!Array.isArray(value)) {
        throw new BadRequestError('ObjectStatus attributes.objectIds must be an array.');
    }
    const objectIds = [ ...new Set(value) ];
    if (objectIds.length > MAX_OBJECT_STATUS_IDS) {
        throw new BadRequestError(`ObjectStatus accepts at most ${ MAX_OBJECT_STATUS_IDS } object ids.`);
    }
    if (!objectIds.every(isValidHash)) {
        throw validationError('Every object id must be a valid content address', 'ObjectIdInvalid', 'attributes.objectIds');
    }
    return objectIds;
}

function validationError(message, code, source) {
    const error = new ValidationError(message, { code });
    error.push(message, source);
    return error;
}
