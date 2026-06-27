import {
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    ConflictError,
    UnauthenticatedError,
    UnsupportedMediaTypeError,
} from '../../../kixx/errors/mod.js';


export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
export const BUILD_ID_HEADER = 'kixx-build-id';


/**
 * Verifies that the request body is a JSON:API document.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {void}
 * @throws {UnsupportedMediaTypeError} When the request payload is not JSON:API.
 */
export function assertJsonApiContentType(request) {
    const contentType = getMediaType(request.headers.get('content-type'));

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

/**
 * Parses HTTP Basic credentials from the Authorization header.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {{ username: string, password: string }} Decoded credentials.
 * @throws {UnauthenticatedError} When Basic credentials are absent or malformed.
 */
export function parseBasicAuthCredentials(request) {
    const authorization = request.headers.get('authorization');

    if (!isNonEmptyString(authorization)) {
        throwBasicAuthError();
    }

    const match = /^Basic\s+(.+)$/iu.exec(authorization);

    if (match === null) {
        throwBasicAuthError();
    }

    const decoded = decodeBasicCredentials(match[1]);
    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex <= 0) {
        throwBasicAuthError();
    }

    return {
        username: decoded.slice(0, separatorIndex),
        password: decoded.slice(separatorIndex + 1),
    };
}

function getMediaType(contentType) {
    if (!isNonEmptyString(contentType)) {
        return '';
    }

    return contentType.split(';', 1)[0].trim().toLowerCase();
}

function decodeBasicCredentials(encodedCredentials) {
    try {
        const binary = atob(encodedCredentials);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
        throwBasicAuthError(cause);
    }
}

function throwBasicAuthError(cause) {
    throw new UnauthenticatedError('Basic authentication credentials are required.', { cause });
}
