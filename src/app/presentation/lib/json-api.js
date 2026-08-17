import {
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    ConflictError,
    UnsupportedMediaTypeError,
} from '../../../kixx/errors/mod.js';


export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';


/**
 * Verifies that the request body is a JSON:API document.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {void}
 * @throws {UnsupportedMediaTypeError} When the request payload is not JSON:API.
 */
export function assertJsonApiContentType(request) {
    const contentType = request.getContentMediaType();

    if (contentType !== JSON_API_CONTENT_TYPE) {
        throw new UnsupportedMediaTypeError(
            `Request Content-Type must be ${ JSON_API_CONTENT_TYPE }.`,
            { accept: [ JSON_API_CONTENT_TYPE ] },
        );
    }
}

/**
 * Parses a JSON:API resource document and returns the resource id and attributes.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} expectedType - JSON:API resource type required by the endpoint.
 * @returns {Promise<{ id: string|undefined, attributes: Object }>} Parsed resource values.
 * @throws {BadRequestError} When the JSON:API envelope is malformed.
 * @throws {ConflictError} When the resource type does not match `expectedType`.
 */
export async function parseJsonApiResource(request, expectedType) {
    assertNonEmptyString(expectedType, 'parseJsonApiResource: expectedType');

    const document = await request.json();

    if (!isPlainObject(document) || !isPlainObject(document.data)) {
        throw new BadRequestError('JSON:API request body must contain a data object.');
    }

    const { data } = document;

    if (!isNonEmptyString(data.type)) {
        throw new BadRequestError('JSON:API resource data.type must be a non-empty string.');
    }

    if (data.type !== expectedType) {
        throw new ConflictError(
            `JSON:API resource type must be ${ expectedType }.`,
            { code: 'JsonApiResourceTypeMismatch' },
        );
    }

    if (!isPlainObject(data.attributes)) {
        throw new BadRequestError('JSON:API resource data.attributes must be an object.');
    }

    return {
        id: data.id,
        attributes: data.attributes,
    };
}

/**
 * Builds a JSON:API resource document for response serialization.
 * @param {Object} args - Resource document values.
 * @param {string} args.type - JSON:API resource type.
 * @param {string} [args.id] - JSON:API resource id.
 * @param {Object} args.attributes - JSON:API resource attributes.
 * @param {Object} [args.meta] - Optional JSON:API resource-level metadata.
 * @returns {{ data: { type: string, id?: string, attributes: Object, meta?: Object } }} JSON:API document.
 */
export function jsonApiResource(args) {
    const {
        type,
        id,
        attributes,
        meta,
    } = args ?? {};

    const data = { type, attributes };

    if (!isUndefined(id)) {
        data.id = id;
    }

    if (!isUndefined(meta)) {
        data.meta = meta;
    }

    return { data };
}
